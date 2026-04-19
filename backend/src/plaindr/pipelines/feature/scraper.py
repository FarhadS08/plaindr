"""Scraping engine — 3-tier cascade for policy URLs.

Tier 1: Fixed browser actions (cookies, scroll, expand) — fast, cheap
Tier 2: Spark AI agent navigates JS-heavy pages — smart, moderate cost
Tier 3: Basic fetch + Markdown — fallback for static pages

Additional capabilities:
- PDF extraction for linked PDF documents
- Iframe detection for embedded policy content
- Multi-page concatenation for paginated policies
- Smart escalation: re-tries with Spark if content validation fails
- Structured error categorization for post-hoc analysis

Protocol-based: accepts any ScraperProtocol implementation
(Playwright, Firecrawl, or HybridScraper). The AI agent (Tier 2)
is optional — only available when an AgentProtocol is provided.
"""

import logging
import time
from dataclasses import dataclass, field
from enum import Enum

from plaindr.clients.protocol import AgentProtocol, ScraperProtocol
from plaindr.pipelines.feature.csv_loader import ScrapingTask


class ScrapeErrorType(Enum):
    """Categorized error types for post-hoc failure analysis.

    Distinguishes transient (retry-safe) from permanent failures,
    enabling targeted debugging and monitoring dashboards.
    """

    NONE = "none"
    TIMEOUT = "timeout"
    RATE_LIMIT = "rate_limit"
    AUTH_ERROR = "auth_error"
    NETWORK_ERROR = "network_error"
    EMPTY_RESPONSE = "empty_response"
    CONTENT_REJECTED = "content_rejected"
    PDF_EXTRACTION = "pdf_extraction"
    UNKNOWN = "unknown"


def _classify_error(error: Exception | str | None) -> ScrapeErrorType:
    """Classify an exception or error string into a category."""
    if error is None:
        return ScrapeErrorType.NONE

    msg = str(error).lower()

    if any(kw in msg for kw in ("timeout", "timed out", "deadline")):
        return ScrapeErrorType.TIMEOUT
    if any(kw in msg for kw in ("429", "rate limit", "too many requests")):
        return ScrapeErrorType.RATE_LIMIT
    if any(kw in msg for kw in ("401", "403", "unauthorized", "forbidden", "auth")):
        return ScrapeErrorType.AUTH_ERROR
    if any(kw in msg for kw in (
        "connection", "dns", "resolve", "refused", "reset",
        "network", "socket", "ssl", "certificate",
    )):
        return ScrapeErrorType.NETWORK_ERROR
    if any(kw in msg for kw in ("empty", "no text", "no content", "no markdown")):
        return ScrapeErrorType.EMPTY_RESPONSE
    if any(kw in msg for kw in ("pdf", "fitz", "pymupdf")):
        return ScrapeErrorType.PDF_EXTRACTION

    return ScrapeErrorType.UNKNOWN

logger = logging.getLogger(__name__)

# Content shorter than this triggers escalation to the next tier.
# A nav menu or button-only page is typically < 200 chars;
# real policy text is always much longer.
_MIN_CONTENT_LENGTH = 200

# Retry config — transient API/network failures should not cause
# permanent content loss for policies.
_SPARK_MAX_RETRIES = 3
_SPARK_RETRY_BASE_DELAY = 2.0  # seconds, doubles each retry

_BASIC_MAX_RETRIES = 3
_BASIC_RETRY_BASE_DELAY = 1.0  # seconds, doubles each retry


@dataclass
class ScrapeResult:
    """Output of a single scrape attempt."""

    task: ScrapingTask
    raw_markdown: str
    success: bool
    error: str | None = None
    error_type: ScrapeErrorType = ScrapeErrorType.NONE
    tier_used: int = 1
    pdf_extracted: bool = False
    iframe_content: list[str] = field(default_factory=list)
    pages_concatenated: int = 1


def scrape_task(
    client: ScraperProtocol,
    task: ScrapingTask,
    agent: AgentProtocol | None = None,
) -> ScrapeResult:
    """Scrape a single policy URL via a 3-tier cascade.

    Tier 1 — scrape_with_pagination: fixed action sequence
        (dismiss cookies, scroll, expand). Fast and cheap.
    Tier 2 — agent_extract_policy: Spark AI agent autonomously
        navigates JS-heavy pages, clicks policy buttons, follows
        links. Used when Tier 1 returns insufficient content.
        Only attempted if an AgentProtocol is provided.
    Tier 3 — scrape: basic fetch. Last resort for static pages.

    Also handles:
    - PDF URLs: detected by extension, downloaded and text-extracted.
    - Iframe content: detected in HTML, scraped separately and appended.
    - Multi-page policies: pagination links followed and concatenated.

    Never raises — failures are captured in the result.
    """
    try:
        # Check if URL points directly to a PDF
        if _is_pdf_url(task.policy_url):
            return _scrape_pdf(client, task)

        # Tier 1: Fixed action sequence with multi-page support
        markdown = client.scrape_with_pagination(task.policy_url)
        pages = markdown.count("\n\n") // 2 + 1 if markdown else 1
        tier_used = 1

        if len(markdown.strip()) < _MIN_CONTENT_LENGTH and agent is not None:
            # Tier 2: Spark AI agent (handles navigation-heavy pages)
            logger.info(
                "Tier 1 insufficient (%d chars), escalating to Spark agent: %s",
                len(markdown.strip()),
                task.policy_url,
            )
            markdown = _scrape_with_spark_retry(agent, task)
            tier_used = 2

        if not markdown.strip():
            # Tier 3: Basic scrape with retry (last resort)
            logger.info(
                "Tier %d empty, falling back to basic scrape: %s",
                tier_used,
                task.policy_url,
            )
            markdown = _scrape_basic_with_retry(client, task)
            tier_used = 3

        if not markdown.strip():
            return ScrapeResult(
                task=task,
                raw_markdown="",
                success=False,
                error="Empty response from all 3 scrape tiers",
                error_type=ScrapeErrorType.EMPTY_RESPONSE,
                tier_used=tier_used,
            )

        # Check for iframe content that might contain additional policy text
        iframe_content = _extract_iframe_content(client, task.policy_url)

        # Append iframe content to main markdown
        if iframe_content:
            markdown = markdown + "\n\n" + "\n\n".join(iframe_content)

        logger.info(
            "Scraped %s (%d chars, tier %d%s)",
            task.policy_url,
            len(markdown),
            tier_used,
            f", +{len(iframe_content)} iframes" if iframe_content else "",
        )
        return ScrapeResult(
            task=task,
            raw_markdown=markdown,
            success=True,
            tier_used=tier_used,
            iframe_content=iframe_content,
            pages_concatenated=pages,
        )
    except Exception as e:
        error_type = _classify_error(e)
        logger.error(
            "Failed to scrape %s [%s]: %s",
            task.policy_url,
            error_type.value,
            e,
        )
        return ScrapeResult(
            task=task,
            raw_markdown="",
            success=False,
            error=str(e),
            error_type=error_type,
        )


def scrape_task_with_escalation(
    client: ScraperProtocol,
    task: ScrapingTask,
    previous_rejection_reason: str,
    agent: AgentProtocol | None = None,
) -> ScrapeResult:
    """Re-scrape a URL with Spark agent after content validation failure.

    When Tier 1 returns content that passes the 200-char escalation
    threshold but fails the content validator (e.g., a marketing page
    with 500+ chars), we bypass Tier 1 and go straight to Spark.

    This handles the gap where landing pages return enough text to
    avoid escalation but the text isn't actually a policy.
    """
    logger.info(
        "Smart escalation to Spark for %s (previous rejection: %s)",
        task.policy_url,
        previous_rejection_reason,
    )

    markdown = ""
    tier_used = 2
    if agent is not None:
        markdown = _scrape_with_spark_retry(agent, task)

    if not markdown.strip():
        # Tier 3 fallback with retry
        logger.info(
            "Spark escalation empty, trying basic scrape with retry: %s",
            task.policy_url,
        )
        markdown = _scrape_basic_with_retry(client, task)
        tier_used = 3

    if not markdown.strip():
        return ScrapeResult(
            task=task,
            raw_markdown="",
            success=False,
            error=(
                f"Smart escalation failed "
                f"(original: {previous_rejection_reason})"
            ),
            tier_used=tier_used,
        )

    return ScrapeResult(
        task=task,
        raw_markdown=markdown,
        success=True,
        tier_used=tier_used,
    )


def _scrape_with_spark_retry(
    agent: AgentProtocol,
    task: ScrapingTask,
) -> str:
    """Call Spark AI agent with exponential backoff retry.

    Transient failures (rate limits, timeouts, network blips)
    should not permanently prevent a policy from being scraped.
    """
    last_error: Exception | None = None
    for attempt in range(1, _SPARK_MAX_RETRIES + 1):
        try:
            result = agent.agent_extract_policy(
                task.policy_url,
                policy_type=task.policy_type,
            )
            if result and result.strip():
                return result
            logger.warning(
                "Spark agent returned empty on attempt %d/%d for %s",
                attempt,
                _SPARK_MAX_RETRIES,
                task.policy_url,
            )
        except Exception as e:
            last_error = e
            logger.warning(
                "Spark agent attempt %d/%d failed for %s: %s",
                attempt,
                _SPARK_MAX_RETRIES,
                task.policy_url,
                e,
            )
        if attempt < _SPARK_MAX_RETRIES:
            delay = _SPARK_RETRY_BASE_DELAY * (2 ** (attempt - 1))
            time.sleep(delay)

    logger.error(
        "Spark agent exhausted all %d retries for %s (last error: %s)",
        _SPARK_MAX_RETRIES,
        task.policy_url,
        last_error,
    )
    return ""


def _scrape_basic_with_retry(
    client: ScraperProtocol,
    task: ScrapingTask,
) -> str:
    """Call basic scrape with exponential backoff retry.

    Tier 3 is the last resort — a transient network blip here means
    permanent content loss. Retries prevent that.
    """
    last_error: Exception | None = None
    for attempt in range(1, _BASIC_MAX_RETRIES + 1):
        try:
            result = client.scrape(task.policy_url)
            if result and result.strip():
                return result
            logger.warning(
                "Basic scrape returned empty on attempt %d/%d for %s",
                attempt,
                _BASIC_MAX_RETRIES,
                task.policy_url,
            )
        except Exception as e:
            last_error = e
            logger.warning(
                "Basic scrape attempt %d/%d failed for %s: %s",
                attempt,
                _BASIC_MAX_RETRIES,
                task.policy_url,
                e,
            )
        if attempt < _BASIC_MAX_RETRIES:
            delay = _BASIC_RETRY_BASE_DELAY * (2 ** (attempt - 1))
            time.sleep(delay)

    logger.error(
        "Basic scrape exhausted all %d retries for %s (last error: %s)",
        _BASIC_MAX_RETRIES,
        task.policy_url,
        last_error,
    )
    return ""


def scrape_batch(
    client: ScraperProtocol,
    tasks: list[ScrapingTask],
    agent: AgentProtocol | None = None,
) -> list[ScrapeResult]:
    """Scrape a list of tasks sequentially, returning all results."""
    results: list[ScrapeResult] = []
    for i, task in enumerate(tasks, 1):
        logger.info(
            "[%d/%d] Scraping %s",
            i,
            len(tasks),
            task.policy_url,
        )
        results.append(scrape_task(client, task, agent=agent))
    return results


# ── Private helpers ──────────────────────────────────


def _is_pdf_url(url: str) -> bool:
    """Check if a URL points to a PDF file."""
    path = url.lower().split("?")[0]
    return path.endswith(".pdf")


def _scrape_pdf(
    client: ScraperProtocol,
    task: ScrapingTask,
) -> ScrapeResult:
    """Extract text from a PDF URL."""
    logger.info("Detected PDF URL, extracting: %s", task.policy_url)
    text = client.extract_pdf(task.policy_url)

    if not text.strip():
        return ScrapeResult(
            task=task,
            raw_markdown="",
            success=False,
            error="PDF extraction returned no text",
            error_type=ScrapeErrorType.PDF_EXTRACTION,
            pdf_extracted=True,
        )

    return ScrapeResult(
        task=task,
        raw_markdown=text,
        success=True,
        pdf_extracted=True,
    )


_IFRAME_MAX_RETRIES = 2
_IFRAME_RETRY_DELAY = 1.0


def _extract_iframe_content(
    client: ScraperProtocol,
    url: str,
) -> list[str]:
    """Detect and extract policy content from iframes on a page.

    Retries both the iframe detection (HTML fetch) and individual
    iframe scraping on transient failures. Policy content in iframes
    (especially DPAs on compliance platforms) is too important to
    lose to a single network blip.
    """
    iframe_urls: list[str] = []

    # Retry iframe URL detection
    for attempt in range(1, _IFRAME_MAX_RETRIES + 1):
        try:
            iframe_urls = client.extract_iframe_urls(url)
            break  # Success
        except Exception as e:
            logger.warning(
                "Iframe detection attempt %d/%d failed for %s: %s",
                attempt, _IFRAME_MAX_RETRIES, url, e,
            )
            if attempt < _IFRAME_MAX_RETRIES:
                time.sleep(_IFRAME_RETRY_DELAY)

    content: list[str] = []
    for iframe_url in iframe_urls:
        text = _scrape_single_iframe(client, iframe_url)
        if text:
            content.append(text)
    return content


def _scrape_single_iframe(
    client: ScraperProtocol,
    iframe_url: str,
) -> str | None:
    """Scrape a single iframe URL with retry on failure."""
    for attempt in range(1, _IFRAME_MAX_RETRIES + 1):
        try:
            if _is_pdf_url(iframe_url):
                text = client.extract_pdf(iframe_url)
            else:
                text = client.scrape(iframe_url)
            if text and text.strip():
                logger.info(
                    "Extracted %d chars from iframe %s",
                    len(text),
                    iframe_url,
                )
                return text.strip()
            return None  # Empty response is not retryable
        except Exception as e:
            logger.warning(
                "Iframe scrape attempt %d/%d failed for %s: %s",
                attempt, _IFRAME_MAX_RETRIES, iframe_url, e,
            )
            if attempt < _IFRAME_MAX_RETRIES:
                time.sleep(_IFRAME_RETRY_DELAY)

    logger.error("Iframe scrape exhausted retries for %s", iframe_url)
    return None
