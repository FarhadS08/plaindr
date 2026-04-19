"""Centralized configuration loaded from environment variables."""

from pathlib import Path

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ROOT_ENV),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Supabase (replaces MongoDB + Pinecone)
    supabase_url: str
    supabase_service_key: SecretStr
    policies_bucket: str = "policies"
    archive_bucket: str = "policies-archive"

    # Scraper backend: "playwright" | "firecrawl" | "hybrid"
    scraper_backend: str = "hybrid"

    # Firecrawl (optional in playwright-only mode)
    firecrawl_api_key: SecretStr = SecretStr("")

    # Anthropic (diff analysis + RAG answer generation)
    anthropic_api_key: SecretStr = SecretStr("")

    # ElevenLabs (voice agent)
    elevenlabs_api_key: SecretStr = SecretStr("")
    elevenlabs_webhook_secret: SecretStr = SecretStr("")

    @field_validator(
        "anthropic_api_key",
        "firecrawl_api_key",
        "elevenlabs_api_key",
        "elevenlabs_webhook_secret",
        "supabase_service_key",
        mode="before",
    )
    @classmethod
    def _coerce_secret(cls, v: object) -> SecretStr:
        """Accept plain str from env, wrap as SecretStr."""
        if isinstance(v, SecretStr):
            return v
        return SecretStr(str(v or ""))

    # Playwright settings
    playwright_headless: bool = True
    playwright_screenshot_dir: str = "logs/screenshots"
    playwright_timeout_ms: int = 30000
    playwright_navigation_timeout_ms: int = 60000

    # FastAPI server
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # Admin + runtime flags
    admin_token: str = ""  # required for /api/store/reload
    debug: bool = False  # relaxes some checks in dev (never enable in prod)
