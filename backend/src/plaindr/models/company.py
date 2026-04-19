"""Company domain model — companies whose AI policies we track."""

from uuid import UUID, uuid4

from pydantic import BaseModel, Field, HttpUrl, field_validator


class CompanyDocument(BaseModel):
    """A company whose AI policies are tracked by the system."""

    id: UUID = Field(default_factory=uuid4)
    name: str
    # Category can be missing for companies discovered via policy URLs
    category: str = "unknown"
    # main_url is a nice-to-have homepage link — not every company has
    # one recorded (especially those added via policy-URL backfills).
    main_url: HttpUrl | None = None

    @field_validator("main_url", mode="before")
    @classmethod
    def _coerce_empty_url(cls, v: object) -> object:
        """Treat empty string as None — Pydantic's HttpUrl rejects ''."""
        if v in ("", None):
            return None
        return v
