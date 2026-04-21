"""One-shot scraping for a user-submitted URL.

The canonical pipeline scrapes hundreds of URLs from a CSV in one run;
user submissions come in one at a time from the API. This module wraps
the same scraping primitives (:func:`scrape_task`, :func:`clean_markdown`,
:func:`md5_hash`) so the submission endpoint reuses them instead of
reimplementing the cascade logic.
"""

from __future__ import annotations

import logging
from contextlib import ExitStack
from dataclasses import dataclass
from uuid import UUID

from plaindr.config import Settings
from plaindr.pipelines.feature.csv_loader import ScrapingTask
from plaindr.pipelines.feature.orchestrator import _create_clients
from plaindr.pipelines.feature.refiner import clean_markdown
from plaindr.pipelines.feature.scraper import scrape_task
from plaindr.utils.hashing import md5_hash

logger = logging.getLogger(__name__)

# Deterministic company_id for user-submitted tasks. The scraper only
# uses this field for logging and downstream metadata; since a one-off
# submission has no associated canonical company, we use a fixed
# sentinel UUID so the task validates cleanly.
_SUBMISSION_COMPANY_ID = UUID("00000000-0000-0000-0000-000000000001")


@dataclass
class SingleScrapeResult:
    """Outcome of a one-off scrape.

    ``error`` is set only when the scrape failed outright — callers
    should treat ``markdown is None`` and ``error is not None`` as the
    failure signal and return a 502 to the API caller.
    """

    markdown: str | None
    content_hash: str | None
    title: str | None
    error: str | None


def scrape_single_url(url: str, settings: Settings) -> SingleScrapeResult:
    """Scrape a single URL using the shared 3-tier cascade.

    Never raises — failures are captured in the ``error`` field. This
    matches :func:`scrape_task` semantics so the router doesn't need a
    try/except layer on top.
    """
    task = ScrapingTask(
        company_id=_SUBMISSION_COMPANY_ID,
        company_name="User submission",
        category="",
        policy_url=url,
        policy_type="general",
    )

    try:
        with ExitStack() as stack:
            scraper, agent, _discovery = _create_clients(settings, stack)
            sr = scrape_task(scraper, task, agent=agent)
    except Exception as exc:
        logger.exception("Single-URL scrape crashed for %s", url)
        return SingleScrapeResult(
            markdown=None,
            content_hash=None,
            title=None,
            error=f"Scrape crashed: {exc}",
        )

    if not sr.success or not sr.raw_markdown.strip():
        return SingleScrapeResult(
            markdown=None,
            content_hash=None,
            title=None,
            error=sr.error or "Scrape returned no content",
        )

    cleaned = clean_markdown(sr.raw_markdown)
    if not cleaned.strip():
        return SingleScrapeResult(
            markdown=None,
            content_hash=None,
            title=None,
            error="Content empty after cleaning",
        )

    title = _extract_title(cleaned)
    return SingleScrapeResult(
        markdown=cleaned,
        content_hash=md5_hash(cleaned),
        title=title,
        error=None,
    )


def _extract_title(markdown: str) -> str | None:
    """Best-effort title lift from the first H1/H2 heading.

    Falls back to the first non-empty line if no heading is present
    — user submissions sometimes scrape into plain text.
    """
    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("# "):
            return stripped[2:].strip() or None
        if stripped.startswith("## "):
            return stripped[3:].strip() or None
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped:
            # Trim to keep the DB row readable
            return stripped[:200]
    return None
