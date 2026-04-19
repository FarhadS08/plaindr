"""Shared fixtures for the Plaindr test suite."""

from datetime import date, datetime
from uuid import UUID

import pytest

from plaindr.models.company import CompanyDocument
from plaindr.models.policy import PolicyDocument
from plaindr.pipelines.feature.csv_loader import ScrapingTask
from plaindr.utils.hashing import md5_hash

# ── Stable UUIDs for deterministic tests ─────────────────

COMPANY_ID = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
AUTHOR_ID = COMPANY_ID


# ── Fixtures ─────────────────────────────────────────────


@pytest.fixture
def company() -> CompanyDocument:
    return CompanyDocument(
        id=COMPANY_ID,
        name="Acme Corp",
        category="coding",
        main_url="https://acme.example.com",
    )


@pytest.fixture
def scraping_task() -> ScrapingTask:
    return ScrapingTask(
        company_id=COMPANY_ID,
        company_name="Acme Corp",
        category="coding",
        policy_url="https://acme.example.com/privacy",
        policy_type="general",
    )


_FIXTURE_CONTENT = (
    "# Privacy Policy\n\n"
    "We respect your privacy. This policy describes how Acme Corp collects, "
    "uses, and protects your personal information and data when you use our services."
)


@pytest.fixture
def policy_document() -> PolicyDocument:
    return PolicyDocument(
        id=md5_hash(_FIXTURE_CONTENT),
        author_id=AUTHOR_ID,
        title="Acme Corp",
        policy_type="general",
        source_url="https://acme.example.com/privacy",
        content=_FIXTURE_CONTENT,
        version=1,
        effective_date=date(2025, 1, 15),
        scraped_at=datetime(2025, 1, 15, 12, 0, 0),
    )
