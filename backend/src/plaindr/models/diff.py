"""Diff domain models — policy change tracking and AI analysis."""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


class PolicyChangeItem(BaseModel):
    """A single identified change within a policy diff."""

    section: str
    change_type: str  # "added", "removed", "modified"
    description: str
    severity: str  # "info", "warning", "breaking"


class PolicyChangeAnalysis(BaseModel):
    """AI-generated analysis of a policy change."""

    summary: str
    key_changes: list[PolicyChangeItem]
    consequences: str
    risk_level: str  # "low", "medium", "high", "critical"


class DiffDocument(BaseModel):
    """A pre-computed diff between two policy versions.

    Stored in the `policy_diffs` MongoDB collection.
    """

    id: str  # f"{old_md5}_{new_md5}"
    source_url: HttpUrl
    author_id: UUID
    old_version_id: str  # MD5 of old version
    new_version_id: str  # MD5 of new version
    old_version: int
    new_version: int
    old_effective_date: date | None = None
    new_effective_date: date | None = None
    diff_text: str  # Unified diff text
    stats: dict  # {lines_added, lines_removed, hunks}
    analysis: PolicyChangeAnalysis | None = None
    analysis_status: str = "completed"  # "completed" | "pending" | "failed"
    analysis_error: str | None = None
    computed_at: datetime = Field(default_factory=datetime.utcnow)
