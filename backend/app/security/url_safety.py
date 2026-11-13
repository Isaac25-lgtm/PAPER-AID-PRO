"""SSRF-safe fetching of remote PDFs.

Every hop (initial URL and each redirect) is resolved, every resolved address must be public, and the TCP
connection is pinned to the validated address (the Host header / SNI keep the original hostname), so a DNS
answer cannot change between the check and the connect (DNS rebinding).
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

from app.errors import UpstreamError, ValidationFailed

MAX_REDIRECTS = 4
MAX_PDF_BYTES = 40 * 1024 * 1024
USER_AGENT = "PaperAidPro/2.0 (+https://paperaid.web.app; scholarly PDF retrieval)"
ALLOWED_PORTS = {80, 443, None}


def is_public_ip(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or (isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"))
    )


@dataclass(frozen=True)
class ResolvedTarget:
    url: str
    host: str
    ip: str


async def resolve_public_target(url: str) -> ResolvedTarget:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"}:
        raise ValidationFailed("Only http(s) URLs can be fetched.")
    if not parts.hostname:
        raise ValidationFailed("URL has no host.")
    if parts.port not in ALLOWED_PORTS:
        raise ValidationFailed("Only standard web ports are allowed.")
    if parts.username or parts.password:
        raise ValidationFailed("URLs with embedded credentials are not allowed.")
    host = parts.hostname
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UpstreamError(f"Could not resolve host '{host}'.") from exc
    addresses = sorted({str(info[4][0]) for info in infos})
    if not addresses or not all(is_public_ip(a) for a in addresses):
        raise ValidationFailed("That address points to a private or reserved network and was blocked.")
    return ResolvedTarget(url=url, host=host, ip=addresses[0])


def _pinned_url(target: ResolvedTarget) -> str:
    parts = urlsplit(target.url)
    ip = f"[{target.ip}]" if ":" in target.ip else target.ip
    netloc = ip if parts.port is None else f"{ip}:{parts.port}"
    return parts._replace(netloc=netloc).geturl()


async def fetch_pdf(url: str, *, timeout_seconds: float = 30.0) -> bytes:
    """Download a PDF with redirect re-validation, IP pinning, a size ceiling and a magic-byte check."""
    current = url
    async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            target = await resolve_public_target(current)
            headers = {"Host": target.host, "User-Agent": USER_AGENT, "Accept": "application/pdf,*/*;q=0.5"}
            extensions = {"sni_hostname": target.host} if urlsplit(current).scheme == "https" else {}
            request = client.build_request("GET", _pinned_url(target), headers=headers, extensions=extensions)
            response = await client.send(request, stream=True)
            try:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise UpstreamError("Redirect without a Location header.")
                    current = urljoin(current, location)
                    continue
                if response.status_code != 200:
                    raise UpstreamError(f"The PDF host returned HTTP {response.status_code}.")
                declared = int(response.headers.get("content-length") or 0)
                if declared > MAX_PDF_BYTES:
                    raise UpstreamError("The PDF is larger than the 40 MB limit.")
                buffer = bytearray()
                async for chunk in response.aiter_bytes():
                    buffer.extend(chunk)
                    if len(buffer) > MAX_PDF_BYTES:
                        raise UpstreamError("The PDF is larger than the 40 MB limit.")
            finally:
                await response.aclose()
            if not bytes(buffer[:1024]).lstrip().startswith(b"%PDF-"):
                raise UpstreamError("The URL did not return a PDF file (publisher landing page or paywall).")
            return bytes(buffer)
    raise UpstreamError("Too many redirects while fetching the PDF.")
