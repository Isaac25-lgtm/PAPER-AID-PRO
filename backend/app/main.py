"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import admin, discovery, documents, library, papers, system, tools
from app.config import get_settings
from app.db.session import dispose_engine
from app.errors import AppError, RateLimited
from app.logging_setup import configure_logging, request_id_var
from app.services.scholarly.http import close_http_client

log = logging.getLogger("app")
API_PREFIX = "/api/v1"

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


def _error(
    status: int, code: str, message: str, details: object = None, headers: dict[str, str] | None = None
) -> JSONResponse:
    return JSONResponse(
        status_code=status, headers=headers, content={"error": {"code": code, "message": message, "details": details}}
    )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    settings.validate_for_production()
    import app.services.processing  # noqa: F401  registers the inline job runner

    log.info("app.started", extra={"env": settings.env, "ai_enabled": settings.ai_enabled})
    housekeeping = asyncio.create_task(_startup_maintenance()) if settings.maintenance_on_startup else None
    yield
    if housekeeping is not None:
        housekeeping.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await housekeeping
    await close_http_client()
    await dispose_engine()


async def _startup_maintenance() -> None:
    """Storage cleanup / bucket purge / stuck-job recovery, a little after start so it never delays serving."""
    from app.services.maintenance import run_maintenance

    await asyncio.sleep(30)
    try:
        await run_maintenance()
    except Exception:
        log.warning("maintenance.failed", exc_info=True)


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, json_output=settings.env != "development")
    app = FastAPI(
        title="PaperAid Pro API",
        version="2.0.0",
        description="Scholarly discovery, personal library, research documents, citations and grounded AI tools.",
        lifespan=lifespan,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=None if settings.is_production else f"{API_PREFIX}/docs",
        redoc_url=None,
    )

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
            # Readable by the SPA (a different origin): paging totals, export counts, download names.
            expose_headers=["X-Total-Count", "X-Item-Count", "Content-Disposition", "X-Request-ID"],
            max_age=600,
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if 8 <= len(incoming) <= 64 and incoming.replace("-", "").isalnum() else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = request_id
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        if request.url.path.startswith(API_PREFIX):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError) -> JSONResponse:
        headers = {"Retry-After": str(exc.retry_after)} if isinstance(exc, RateLimited) else None
        if exc.status_code >= 500:
            log.warning("app.error", extra={"code": exc.code, "error_message": exc.message})
        return _error(exc.status_code, exc.code, exc.message, exc.details, headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
        return _error(422, "VALIDATION_FAILED", "Some fields are invalid.", details)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        return _error(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("app.unhandled_error")
        return _error(500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.")

    for module in (system, discovery, papers, library, documents, tools):
        app.include_router(module.router, prefix=API_PREFIX)
    app.include_router(admin.router, prefix=API_PREFIX)
    app.include_router(admin.internal)
    return app


app = create_app()
