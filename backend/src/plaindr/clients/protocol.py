"""Scraper protocols — pluggable backend contracts for the pipeline.

Three separate protocols enforce Interface Segregation:
- ScraperProtocol: page scraping, PDF extraction, iframe detection
- AgentProtocol: AI-driven autonomous page navigation (Firecrawl Spark)
- UrlDiscoveryProtocol: domain-level URL mapping (Firecrawl map())

FirecrawlClient satisfies all three implicitly (structural subtyping).
PlaywrightClient satisfies only ScraperProtocol.
"""

from __future__ import annotations

import logging
from typing import Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@runtime_checkable
class ScraperProtocol(Protocol):
    """Contract for page-level scraping operations.

    Both PlaywrightClient and FirecrawlClient satisfy this protocol.
    The pipeline's 3-tier cascade (Tier 1 and Tier 3) uses these methods.
    """

    def scrape(self, url: str) -> str:
        """Basic scrape — fetch URL and return Markdown."""
        ...

    def scrape_with_actions(self, url: str) -> str:
        """Scrape with browser actions (cookie dismiss, scroll, expand)."""
        ...

    def scrape_with_pagination(self, url: str) -> str:
        """Scrape with pagination detection and multi-page concatenation."""
        ...

    def extract_pdf(self, url: str) -> str:
        """Download a PDF and extract text as Markdown."""
        ...

    def extract_iframe_urls(self, url: str) -> list[str]:
        """Detect iframe src URLs that may contain policy content."""
        ...


@runtime_checkable
class AgentProtocol(Protocol):
    """Contract for AI-driven autonomous page navigation.

    Only FirecrawlClient satisfies this (via Spark agent).
    Playwright has no equivalent — it's a browser automation tool,
    not an AI navigator.
    """

    def agent_extract_policy(
        self,
        url: str,
        policy_type: str = "general",
    ) -> str:
        """Use AI agent to navigate a page and extract policy content."""
        ...


@runtime_checkable
class UrlDiscoveryProtocol(Protocol):
    """Contract for domain-level URL discovery.

    Only FirecrawlClient satisfies this (via map() API).
    Playwright has no domain-crawling equivalent.
    """

    def map_policy_urls(self, domain_url: str) -> list[str]:
        """Discover policy-related URLs on a domain."""
        ...


class HybridScraper:
    """Tries the primary scraper first, falls back to secondary.

    Implements ScraperProtocol by delegating to two backing scrapers.
    Default config: Playwright (primary) + Firecrawl (fallback).

    The fallback triggers when the primary returns empty content
    or raises an exception — ensuring maximum content coverage.
    """

    def __init__(
        self,
        primary: ScraperProtocol,
        fallback: ScraperProtocol,
    ) -> None:
        self._primary = primary
        self._fallback = fallback

    def _try_with_fallback(
        self,
        method_name: str,
        url: str,
    ) -> str:
        """Try primary, fall back to secondary on empty or error."""
        try:
            result = getattr(self._primary, method_name)(url)
            if result and result.strip():
                logger.debug(
                    "Primary scraper succeeded for %s (%s)",
                    url, method_name,
                )
                return result
        except Exception as e:
            logger.warning(
                "Primary scraper failed for %s (%s): %s",
                url, method_name, e,
            )

        logger.info(
            "Falling back to secondary scraper for %s (%s)",
            url, method_name,
        )
        return getattr(self._fallback, method_name)(url)

    def scrape(self, url: str) -> str:
        return self._try_with_fallback("scrape", url)

    def scrape_with_actions(self, url: str) -> str:
        return self._try_with_fallback("scrape_with_actions", url)

    def scrape_with_pagination(self, url: str) -> str:
        return self._try_with_fallback("scrape_with_pagination", url)

    def extract_pdf(self, url: str) -> str:
        return self._try_with_fallback("extract_pdf", url)

    def extract_iframe_urls(self, url: str) -> list[str]:
        """Iframe detection — merge results from both scrapers.

        Unlike text scraping (where we want the best single result),
        iframe detection benefits from BOTH backends: Playwright catches
        JS-injected iframes, Firecrawl catches ones in initial HTML.
        """
        primary_urls: list[str] = []
        try:
            primary_urls = self._primary.extract_iframe_urls(url)
        except Exception as e:
            logger.warning(
                "Primary iframe detection failed for %s: %s", url, e,
            )

        fallback_urls: list[str] = []
        try:
            fallback_urls = self._fallback.extract_iframe_urls(url)
        except Exception as e:
            logger.warning(
                "Fallback iframe detection failed for %s: %s", url, e,
            )

        # Deduplicate while preserving order
        seen: set[str] = set()
        merged: list[str] = []
        for u in primary_urls + fallback_urls:
            normalized = u.rstrip("/").lower()
            if normalized not in seen:
                seen.add(normalized)
                merged.append(u)

        return merged
