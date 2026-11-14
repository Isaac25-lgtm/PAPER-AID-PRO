"""Application settings, loaded from environment variables (and an optional .env file in development).

Every setting has a safe default for local development. `Settings.validate_for_production()` enforces the
settings that must be explicit when ENV=production, so a misconfigured deployment fails at startup rather
than at the first request.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]
AIProvider = Literal["anthropic", "openai", "gemini", "none"]
EmbeddingProvider = Literal["openai", "gemini", "none"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Environment = "development"
    app_name: str = "PaperAid Pro API"
    log_level: str = "INFO"

    # --- Database -------------------------------------------------------------------------------------
    database_url: str = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/paperaid"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_echo: bool = False

    # --- Auth (Firebase Authentication) ---------------------------------------------------------------
    firebase_project_id: str = "paperaid"
    require_email_verified: bool = True
    # Every account must accept the current Terms/Privacy notice (recorded in consent_records) before using the app.
    require_policy_acceptance: bool = True
    # Comma-separated emails that are promoted to ADMIN on first sign-in (bootstrap only).
    admin_emails: str = ""
    # Invite-only mode: comma-separated emails allowed to use signed-in features (admins always allowed).
    # Empty = open to anyone who signs up.
    allowed_emails: str = ""

    # --- HTTP -----------------------------------------------------------------------------------------
    cors_origins: str = ""  # comma-separated; empty = same-origin only (Firebase Hosting rewrite)
    max_upload_mb: int = 25
    public_base_url: str = "http://localhost:5173"

    # --- File storage -----------------------------------------------------------------------------------
    storage_backend: Literal["gcs", "local"] = "local"
    gcs_bucket: str = ""
    local_storage_dir: str = ".storage"

    # --- Background tasks ---------------------------------------------------------------------------------
    tasks_backend: Literal["cloud_tasks", "inline"] = "inline"
    tasks_project: str = ""
    tasks_location: str = "europe-west4"
    tasks_queue: str = "paper-processing"
    tasks_target_url: str = ""  # public URL of this service, used as the Cloud Tasks target + OIDC audience
    tasks_service_account: str = ""  # service account Cloud Tasks signs OIDC tokens as

    # --- Scholarly APIs -------------------------------------------------------------------------------
    # A real, monitored contact address enables the Crossref/OpenAlex "polite pool" and is required by
    # Unpaywall. Leave empty to omit it (requests still work; Unpaywall lookups are skipped).
    contact_email: str = ""
    ncbi_api_key: str = ""
    semantic_scholar_api_key: str = ""
    core_api_key: str = ""  # free key from core.ac.uk; enables CORE (open-access papers in every discipline)
    http_timeout_seconds: float = 15.0

    # --- AI (configured later; every AI endpoint returns 503 AI_NOT_CONFIGURED until then) -----------
    ai_provider: AIProvider = "none"
    # Who may use AI features once a provider key is set. "pilot" (default): only AI_PILOT_EMAILS (and admins);
    # "everyone": every verified, consenting tester. Nobody gets AI by accident when a key is added.
    ai_access: Literal["pilot", "everyone"] = "pilot"
    ai_pilot_emails: str = ""
    # Inline writing suggestions send draft context automatically, so they have their own switch (off by default)
    # and each person must also turn them on in the editor.
    ai_autocomplete_enabled: bool = False
    ai_model: str = ""  # empty = provider default
    ai_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""
    embedding_provider: EmbeddingProvider = "none"
    embedding_model: str = ""
    embedding_dimensions: int = Field(default=1536, frozen=True)  # fixed by the pgvector column

    # Verify each AI claim against its cited passages with a second model call (recommended).
    ai_verify_claims: bool = True

    # --- Operations ---------------------------------------------------------------------------------------
    maintenance_on_startup: bool = True
    # Cloud Run's front end appends the caller's address as the LAST X-Forwarded-For entry; trust only that.
    # None = automatic (trusted in production, where the API only runs behind Cloud Run).
    trust_forwarded_for: bool | None = None

    # --- Rate limits (per user per minute unless noted) -------------------------------------------------
    rate_limit_search_per_min: int = 30
    rate_limit_ai_per_min: int = 10
    rate_limit_upload_per_hour: int = 30

    @field_validator("database_url")
    @classmethod
    def _normalise_driver(cls, value: str) -> str:
        # Accept plain postgres URLs and pin the psycopg (v3) driver.
        for prefix in ("postgresql://", "postgres://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def allowed_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}

    def is_email_allowed(self, email: str) -> bool:
        allowed = self.allowed_email_set
        return not allowed or email.lower() in allowed or email.lower() in self.admin_email_set

    @property
    def admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    @property
    def trusts_forwarded_for(self) -> bool:
        return self.is_production if self.trust_forwarded_for is None else self.trust_forwarded_for

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def ai_pilot_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.ai_pilot_emails.split(",") if e.strip()}

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def ai_enabled(self) -> bool:
        key = {
            "anthropic": self.anthropic_api_key,
            "openai": self.openai_api_key,
            "gemini": self.gemini_api_key,
        }.get(self.ai_provider, "")
        return self.ai_provider != "none" and bool(key)

    @property
    def embeddings_enabled(self) -> bool:
        key = {"openai": self.openai_api_key, "gemini": self.gemini_api_key}.get(self.embedding_provider, "")
        return self.embedding_provider != "none" and bool(key)

    def validate_for_production(self) -> None:
        if not self.is_production:
            return
        problems: list[str] = []
        if "127.0.0.1" in self.database_url or "localhost" in self.database_url:
            problems.append("DATABASE_URL points at localhost")
        if self.storage_backend != "gcs" or not self.gcs_bucket:
            problems.append("STORAGE_BACKEND must be 'gcs' with GCS_BUCKET set")
        if self.tasks_backend != "cloud_tasks":
            problems.append("TASKS_BACKEND must be 'cloud_tasks'")
        if self.tasks_backend == "cloud_tasks" and not (
            self.tasks_project and self.tasks_target_url and self.tasks_service_account
        ):
            problems.append("TASKS_PROJECT, TASKS_TARGET_URL and TASKS_SERVICE_ACCOUNT are required")
        if not self.require_email_verified:
            problems.append("REQUIRE_EMAIL_VERIFIED must be true")
        if problems:
            raise RuntimeError("Invalid production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
