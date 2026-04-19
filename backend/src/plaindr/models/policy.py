"""Policy domain model — maps to the MongoDB 'policies' collection."""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl, field_validator

# Minimum content length enforced at the model level.
# This is a last-resort safety net — the content_validator
# module in the pipeline enforces a stricter check (500 chars).
_MODEL_MIN_CONTENT_LENGTH = 50


class PolicyDocument(BaseModel):
    """A single scraped and cleaned policy document.

    The `id` field is an MD5 hash of the cleaned content,
    used for deduplication and weekly change detection.
    The `policies` collection is keyed by `source_url` —
    one document per URL, always the latest version.
    """

    id: str  # MD5 hash of content
    author_id: UUID  # FK → CompanyDocument.id
    title: str
    policy_type: str  # e.g. "general", "developer", "health"
    source_url: HttpUrl
    content: str  # Cleaned Markdown
    version: int = 1
    effective_date: date | None = None
    scraped_at: datetime = Field(default_factory=datetime.utcnow)
    previous_version_id: str | None = None  # MD5 of replaced version
    summary: str | None = None  # LLM-generated policy summary

    @field_validator("content")
    @classmethod
    def content_must_be_non_trivial(cls, v: str) -> str:
        """Reject empty or near-empty content at the model level."""
        stripped = v.strip()
        if not stripped:
            msg = "Policy content cannot be empty"
            raise ValueError(msg)
        if len(stripped) < _MODEL_MIN_CONTENT_LENGTH:
            msg = (
                f"Policy content too short ({len(stripped)} chars, "
                f"minimum {_MODEL_MIN_CONTENT_LENGTH})"
            )
            raise ValueError(msg)
        return v

    @field_validator("id")
    @classmethod
    def id_must_be_md5_length(cls, v: str) -> str:
        """Ensure ID looks like an MD5 hash (32 hex chars)."""
        if len(v) != 32 or not all(c in "0123456789abcdef" for c in v):
            msg = f"Policy ID must be a 32-character hex MD5 hash, got: {v!r}"
            raise ValueError(msg)
        return v
