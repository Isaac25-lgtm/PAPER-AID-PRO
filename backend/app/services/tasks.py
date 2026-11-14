"""Background job dispatch.

Production: Google Cloud Tasks (REST API) delivers each job to POST /internal/tasks/run-job on this service
with an OIDC token signed for our task service account; Cloud Tasks retries on failure with backoff.
Development/tests: jobs run inline (awaited) so behaviour is deterministic.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid
from collections.abc import Awaitable, Callable

import google.auth
import google.auth.transport.requests
import httpx
import requests
from google.oauth2 import id_token as google_id_token

from app.config import get_settings
from app.errors import Unauthenticated, UpstreamError

log = logging.getLogger(__name__)

JobRunner = Callable[[uuid.UUID], Awaitable[str]]  # returns "done" | "retry" | "skipped"
INLINE_MAX_DELIVERIES = 5
_inline_runner: JobRunner | None = None
_credentials = None


def register_inline_runner(runner: JobRunner) -> None:
    global _inline_runner
    _inline_runner = runner


async def _cloud_tasks_token() -> str:
    global _credentials
    if _credentials is None:
        _credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not _credentials.valid:
        await asyncio.to_thread(_credentials.refresh, google.auth.transport.requests.Request())
    return str(_credentials.token)


# gRPC/HTTP outcomes of a create call that do not prove the task was NOT created.
AMBIGUOUS_STATUSES = {"DEADLINE_EXCEEDED", "UNAVAILABLE", "INTERNAL", "UNKNOWN", "ABORTED", "CANCELLED"}


def _error_status(response: httpx.Response) -> str:
    try:
        return str(response.json().get("error", {}).get("status", ""))
    except ValueError:
        return ""


class DispatchRejected(UpstreamError):
    """The queue definitely did not accept the job."""


class DispatchUncertain(UpstreamError):
    """The request may have reached the queue; the job may run."""


async def enqueue_job(job_id: uuid.UUID) -> None:
    settings = get_settings()
    if settings.tasks_backend == "inline":
        if _inline_runner is None:
            raise RuntimeError("No inline job runner registered")
        # Mimic Cloud Tasks: redeliver while the worker asks for a retry (the worker caps its own attempts).
        for _ in range(INLINE_MAX_DELIVERIES):
            if await _inline_runner(job_id) != "retry":
                break
        return

    target = settings.tasks_target_url.rstrip("/") + "/internal/tasks/run-job"
    body = base64.b64encode(json.dumps({"job_id": str(job_id)}).encode()).decode()
    queue = f"projects/{settings.tasks_project}/locations/{settings.tasks_location}/queues/{settings.tasks_queue}"
    payload = {
        "task": {
            # A stable name per job: if a create request's response is lost and it is sent again, Cloud Tasks
            # reports ALREADY_EXISTS instead of queuing the job twice.
            "name": f"{queue}/tasks/job-{job_id}",
            "httpRequest": {
                "httpMethod": "POST",
                "url": target,
                "headers": {"Content-Type": "application/json"},
                "body": body,
                "oidcToken": {
                    "serviceAccountEmail": settings.tasks_service_account,
                    "audience": settings.tasks_target_url.rstrip("/"),
                },
            },
            "dispatchDeadline": "900s",
        }
    }
    headers = {"Authorization": f"Bearer {await _cloud_tasks_token()}"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"https://cloudtasks.googleapis.com/v2/{queue}/tasks", json=payload, headers=headers
            )
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:  # nothing was sent
        raise DispatchRejected("Could not reach the processing queue. Please retry.") from exc
    except httpx.TransportError as exc:  # sent, but the outcome is unknown (e.g. the response timed out)
        raise DispatchUncertain("The processing queue did not confirm the job in time.") from exc
    if response.status_code == 409:  # ALREADY_EXISTS: an earlier attempt for this job was accepted
        return
    if response.status_code >= 300:
        status = _error_status(response)
        log.error("tasks.enqueue_failed", extra={"status": response.status_code, "rpc_status": status})
        if response.status_code >= 500 or status in AMBIGUOUS_STATUSES:
            # The create may have taken effect (e.g. DEADLINE_EXCEEDED after acceptance): never fail the job here.
            raise DispatchUncertain("The processing queue did not confirm the job.")
        raise DispatchRejected("Could not queue the processing job. Please retry.")


_oidc_request = google.auth.transport.requests.Request(session=requests.Session())


def verify_task_request(authorization: str | None) -> None:
    """Only Cloud Tasks (our service account, our audience) may call the internal job endpoint."""
    settings = get_settings()
    if settings.tasks_backend != "cloud_tasks":
        raise Unauthenticated("Internal task endpoint is disabled.")
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise Unauthenticated("Missing task token.")
    try:
        claims = google_id_token.verify_oauth2_token(
            token, _oidc_request, audience=settings.tasks_target_url.rstrip("/")
        )
    except Exception as exc:
        raise Unauthenticated("Invalid task token.") from exc
    if claims.get("email") != settings.tasks_service_account or not claims.get("email_verified"):
        raise Unauthenticated("Task token was not issued by the task service account.")
