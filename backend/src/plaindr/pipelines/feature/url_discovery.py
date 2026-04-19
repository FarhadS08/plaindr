"""URL discovery — pre-scrape enrichment that finds policy URLs
missed by the CSV using Firecrawl's domain mapping.

This module runs BEFORE the scraping phase. It takes the existing
CSV tasks, groups them by company domain, and uses map() to discover
additional policy URLs on each domain. New URLs are added as extra
ScrapingTask entries with inferred policy types.

The goal: if a company has a policy page that wasn't in the CSV,
we find it and scrape it anyway — zero policies missed.
"""

import logging
import re
from urllib.parse import urlparse

from plaindr.clients.protocol import UrlDiscoveryProtocol
from plaindr.pipelines.feature.csv_loader import ScrapingTask

logger = logging.getLogger(__name__)


# ── Policy type inference from URL path ───────────────

_TYPE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"privacy", re.IGNORECASE), "privacy"),
    (re.compile(r"cookie", re.IGNORECASE), "privacy"),
    (re.compile(r"(?:terms|tos|eula)", re.IGNORECASE), "tos"),
    (re.compile(r"(?:security|compliance|soc)", re.IGNORECASE), "security"),
    (re.compile(r"(?:dpa|data.?processing)", re.IGNORECASE), "privacy"),
    (re.compile(r"(?:gdpr|ccpa)", re.IGNORECASE), "privacy"),
    (re.compile(r"(?:acceptable.?use|aup)", re.IGNORECASE), "tos"),
]


def _infer_policy_type(url: str) -> str:
    """Infer the policy type from a URL path. Defaults to 'general'."""
    path = urlparse(url).path.lower()
    for pattern, policy_type in _TYPE_PATTERNS:
        if pattern.search(path):
            return policy_type
    return "general"


def _extract_domain(url: str) -> str:
    """Extract the root domain from a URL for map() queries."""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _normalize_url(url: str) -> str:
    """Normalize a URL for dedup comparison."""
    return url.rstrip("/").lower()


def discover_missing_urls(
    firecrawl: UrlDiscoveryProtocol,
    tasks: list[ScrapingTask],
) -> list[ScrapingTask]:
    """Discover policy URLs via map() that aren't already in the task list.

    Groups tasks by company domain, runs map() once per domain,
    and creates new ScrapingTask entries for any discovered URLs
    that weren't in the original CSV.

    Args:
        firecrawl: Initialized Firecrawl client.
        tasks: Existing tasks from CSV explosion.

    Returns:
        List of NEW ScrapingTask entries to append to the task list.
        Does not include duplicates of existing tasks.
    """
    # Group tasks by company, collect existing URLs per company
    company_domains: dict[str, _CompanyInfo] = {}
    for task in tasks:
        domain = _extract_domain(task.policy_url)
        key = f"{task.company_id}:{domain}"
        if key not in company_domains:
            company_domains[key] = _CompanyInfo(
                company_id=task.company_id,
                company_name=task.company_name,
                category=task.category,
                domain=domain,
                existing_urls=set(),
            )
        company_domains[key].existing_urls.add(
            _normalize_url(task.policy_url)
        )

    new_tasks: list[ScrapingTask] = []

    for _key, info in company_domains.items():
        logger.info(
            "Running map() discovery for %s (%s)",
            info.company_name,
            info.domain,
        )
        discovered = firecrawl.map_policy_urls(info.domain)

        for url in discovered:
            if _normalize_url(url) in info.existing_urls:
                continue

            policy_type = _infer_policy_type(url)
            new_task = ScrapingTask(
                company_id=info.company_id,
                company_name=info.company_name,
                category=info.category,
                policy_url=url,
                policy_type=policy_type,
            )
            new_tasks.append(new_task)
            # Add to existing set to prevent duplicates within discovery
            info.existing_urls.add(_normalize_url(url))
            logger.info(
                "Discovered new %s policy URL for %s: %s",
                policy_type,
                info.company_name,
                url,
            )

    logger.info(
        "URL discovery complete: %d new URLs found across %d domains",
        len(new_tasks),
        len(company_domains),
    )
    return new_tasks


class _CompanyInfo:
    """Internal grouping for URL discovery per company domain."""

    __slots__ = (
        "company_id",
        "company_name",
        "category",
        "domain",
        "existing_urls",
    )

    def __init__(
        self,
        company_id,
        company_name: str,
        category: str,
        domain: str,
        existing_urls: set[str],
    ) -> None:
        self.company_id = company_id
        self.company_name = company_name
        self.category = category
        self.domain = domain
        self.existing_urls = existing_urls
