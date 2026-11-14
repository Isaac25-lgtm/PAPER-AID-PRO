"""Private object storage for uploaded/retrieved PDFs.

Production: Google Cloud Storage via its JSON API, authenticated with the Cloud Run service account
(application default credentials). Development/tests: a local directory. Objects are never public; the API
streams them to authorized users.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import google.auth
import google.auth.transport.requests
import httpx

from app.config import get_settings
from app.errors import NotFound, UpstreamError


class ObjectStorage(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...
    async def get(self, key: str) -> bytes: ...
    async def open_stream(self, key: str) -> AsyncIterator[bytes]:
        """Resolve the object (raising NotFound before any byte is sent) and return a chunk iterator."""
        ...

    async def delete(self, key: str) -> None: ...


CHUNK_SIZE = 64 * 1024


def _safe_key(key: str) -> str:
    parts = [p for p in key.replace("\\", "/").split("/") if p]
    if not parts or any(p in {".", ".."} for p in parts):
        raise ValueError("Invalid storage key")
    return "/".join(parts)


class LocalStorage:
    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        path = (self.root / _safe_key(key)).resolve()
        if self.root not in path.parents:
            raise ValueError("Invalid storage key")
        return path

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        await asyncio.to_thread(path.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, data)

    async def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.exists():
            raise NotFound("File not found in storage.")
        return await asyncio.to_thread(path.read_bytes)

    async def open_stream(self, key: str) -> AsyncIterator[bytes]:
        path = self._path(key)
        if not path.exists():
            raise NotFound("File not found in storage.")
        handle = await asyncio.to_thread(path.open, "rb")

        async def body() -> AsyncIterator[bytes]:
            try:
                while chunk := await asyncio.to_thread(handle.read, CHUNK_SIZE):
                    yield chunk
            finally:
                await asyncio.to_thread(handle.close)

        return body()

    async def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            await asyncio.to_thread(path.unlink)


class GCSStorage:
    _scopes = ("https://www.googleapis.com/auth/devstorage.read_write",)

    def __init__(self, bucket: str) -> None:
        self.bucket = bucket
        self._credentials, _ = google.auth.default(scopes=self._scopes)
        self._lock = asyncio.Lock()

    async def _token(self) -> str:
        async with self._lock:
            if not self._credentials.valid:
                await asyncio.to_thread(self._credentials.refresh, google.auth.transport.requests.Request())
            return str(self._credentials.token)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        url = f"https://storage.googleapis.com/upload/storage/v1/b/{self.bucket}/o"
        params = {"uploadType": "media", "name": _safe_key(key)}
        headers = {"Authorization": f"Bearer {await self._token()}", "Content-Type": content_type}
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(url, params=params, content=data, headers=headers)
        if response.status_code >= 300:
            raise UpstreamError(f"Storage upload failed (HTTP {response.status_code}).")

    async def get(self, key: str) -> bytes:
        name = quote(_safe_key(key), safe="")
        url = f"https://storage.googleapis.com/storage/v1/b/{self.bucket}/o/{name}"
        headers = {"Authorization": f"Bearer {await self._token()}"}
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.get(url, params={"alt": "media"}, headers=headers)
        if response.status_code == 404:
            raise NotFound("File not found in storage.")
        if response.status_code >= 300:
            raise UpstreamError(f"Storage download failed (HTTP {response.status_code}).")
        return response.content

    async def open_stream(self, key: str) -> AsyncIterator[bytes]:
        name = quote(_safe_key(key), safe="")
        url = f"https://storage.googleapis.com/storage/v1/b/{self.bucket}/o/{name}"
        headers = {"Authorization": f"Bearer {await self._token()}"}
        client = httpx.AsyncClient(timeout=120)
        response = await client.send(
            client.build_request("GET", url, params={"alt": "media"}, headers=headers), stream=True
        )
        if response.status_code >= 300:
            status = response.status_code
            await response.aclose()
            await client.aclose()
            if status == 404:
                raise NotFound("File not found in storage.")
            raise UpstreamError(f"Storage download failed (HTTP {status}).")

        async def body() -> AsyncIterator[bytes]:
            try:
                async for chunk in response.aiter_bytes(CHUNK_SIZE):
                    yield chunk
            finally:  # also runs when the client disconnects mid-download
                await response.aclose()
                await client.aclose()

        return body()

    async def delete(self, key: str) -> None:
        name = quote(_safe_key(key), safe="")
        url = f"https://storage.googleapis.com/storage/v1/b/{self.bucket}/o/{name}"
        headers = {"Authorization": f"Bearer {await self._token()}"}
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.delete(url, headers=headers)
        if response.status_code not in {200, 204, 404}:
            raise UpstreamError(f"Storage delete failed (HTTP {response.status_code}).")


_storage: ObjectStorage | None = None


def get_storage() -> ObjectStorage:
    global _storage
    if _storage is None:
        settings = get_settings()
        if settings.storage_backend == "gcs":
            _storage = GCSStorage(settings.gcs_bucket)
        else:
            _storage = LocalStorage(settings.local_storage_dir)
    return _storage


def set_storage(storage: ObjectStorage | None) -> None:
    global _storage
    _storage = storage


def pdf_key(paper_id: str, sha256: str) -> str:
    return f"papers/{paper_id}/{sha256}.pdf"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
