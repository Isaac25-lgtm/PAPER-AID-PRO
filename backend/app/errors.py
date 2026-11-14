"""Typed application errors. Every error response has the shape {"error": {"code", "message", "details"}}."""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    status_code = 400
    code = "BAD_REQUEST"

    def __init__(self, message: str, *, code: str | None = None, details: Any = None) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        self.details = details


class ValidationFailed(AppError):
    status_code = 422
    code = "VALIDATION_FAILED"


class Unauthenticated(AppError):
    status_code = 401
    code = "UNAUTHENTICATED"


class NotInvited(AppError):
    status_code = 403
    code = "NOT_INVITED"


class EmailNotVerified(AppError):
    status_code = 403
    code = "EMAIL_NOT_VERIFIED"


class AccountConflict(AppError):
    status_code = 409
    code = "ACCOUNT_CONFLICT"


class Forbidden(AppError):
    status_code = 403
    code = "FORBIDDEN"


class NotFound(AppError):
    status_code = 404
    code = "NOT_FOUND"


class Conflict(AppError):
    status_code = 409
    code = "CONFLICT"


class PayloadTooLarge(AppError):
    status_code = 413
    code = "PAYLOAD_TOO_LARGE"


class RateLimited(AppError):
    status_code = 429
    code = "RATE_LIMITED"

    def __init__(self, message: str, *, retry_after: int) -> None:
        super().__init__(message, details={"retry_after_seconds": retry_after})
        self.retry_after = retry_after


class UpstreamError(AppError):
    status_code = 502
    code = "UPSTREAM_ERROR"


class AINotConfigured(AppError):
    status_code = 503
    code = "AI_NOT_CONFIGURED"

    def __init__(self, feature: str = "This feature") -> None:
        super().__init__(f"{feature} requires an AI provider, which has not been configured on this deployment yet.")


class AIRefused(AppError):
    status_code = 422
    code = "AI_REFUSED"


class AIOutputInvalid(AppError):
    """The model answered, but the answer failed grounding/citation validation and was discarded."""

    status_code = 502
    code = "AI_OUTPUT_INVALID"
