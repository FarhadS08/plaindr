"""Firecrawl client — multi-tier agentic web scraping for policy pages.

Satisfies all three protocols:
- ScraperProtocol: scrape, scrape_with_actions, scrape_with_pagination,
                   extract_pdf, extract_iframe_urls
- AgentProtocol: agent_extract_policy (Spark AI agent)
- UrlDiscoveryProtocol: map_policy_urls (domain-level URL discovery)
"""

import logging
import re
from urllib.parse import urlparse

import httpx
from firecrawl import FirecrawlApp
from pydantic import BaseModel

from plaindr.clients._shared import (
    COOKIE_SELECTORS,
    EXPAND_SELECTORS,
    extract_iframe_urls_from_html,
    extract_pdf_from_url,
    find_next_page_url,
    find_next_page_url_html,
    is_policy_iframe,
)
from plaindr.config import Settings

logger = logging.getLogger(__name__)

# Re-export shared utilities for backward compatibility with existing tests
_is_policy_iframe = is_policy_iframe
_find_next_page_url = find_next_page_url


class PolicyExtraction(BaseModel):
    """Schema for Spark agent policy extraction output."""

    policy_text: str
    policy_title: str
    policy_type: str


class FirecrawlClient:
    """Wrapper around the Firecrawl SDK for policy scraping.

    Provides a 3-tier scraping cascade:
    1. Actions: Fixed browser actions (cookies, scroll, expand) — fast, cheap
    2. Spark Agent: AI navigates JS-heavy pages autonomously — smart, moderate cost
    3. Basic: Simple fetch + Markdown — fallback for static pages
    """

    def __init__(self, settings: Settings) -> None:
        self._app = FirecrawlApp(
            api_key=settings.firecrawl_api_key.get_secret_value()
        )

    def scrape(self, url: str) -> str:
        """Basic scrape — fetch URL and return Markdown.

        Requests Markdown format to preserve heading hierarchy
        of legal clauses. Strips non-main content by default.
        """
        result = self._app.scrape(
            url,
            formats=["markdown"],
            only_main_content=True,
        )
        markdown = result.markdown or ""
        if not markdown:
            logger.warning("No markdown returned for %s", url)
        return markdown

    def scrape_with_actions(self, url: str) -> str:
        """Agentic scrape — dismiss popups, scroll, expand, then extract.

        Runs a sequence of browser actions before content extraction
        to handle dynamic policy pages that require JS rendering,
        cookie consent dismissal, lazy-loading, or collapsed sections.

        Firecrawl constraints: max 50 actions, max 60s combined wait.

        Why executeJavascript instead of click: Firecrawl's `click` action
        hard-fails if the selector matches nothing on the page (which is the
        common case — most of ~130 company sites don't have every one of our
        cookie / expand selectors). Running `querySelectorAll(...).forEach(
        el => el.click())` is silent-safe when the set is empty, so the
        scrape keeps going instead of the whole run dying on missing UI.
        """
        def safe_click_script(selectors: str) -> str:
            # querySelectorAll on an empty match set is a no-op, so this
            # never throws — unlike Firecrawl's `click` action which
            # hard-fails on selector misses.
            escaped = selectors.replace("'", "\\'")
            return (
                "document.querySelectorAll('" + escaped + "')"
                ".forEach(function (el) { try { el.click(); } catch (e) {} });"
            )

        actions: list[dict] = [
            # 1. Wait for initial JS rendering
            {"type": "wait", "milliseconds": 2000},
            # 2. Dismiss cookie consent / GDPR banners (no-op if not present)
            {"type": "executeJavascript", "script": safe_click_script(COOKIE_SELECTORS)},
            {"type": "wait", "milliseconds": 500},
            # 3. Scroll down to trigger lazy-loaded content
            {"type": "scroll", "direction": "down", "amount": 5},
            {"type": "wait", "milliseconds": 1000},
            # 4. Expand collapsed "read more" / accordion sections
            {"type": "executeJavascript", "script": safe_click_script(EXPAND_SELECTORS)},
            {"type": "wait", "milliseconds": 500},
            # 5. Scroll back up so scrape captures full page
            {"type": "scroll", "direction": "up", "amount": 5},
            {"type": "wait", "milliseconds": 300},
            # 6. Final scrape to capture fully-rendered content
            {"type": "scrape"},
        ]
        result = self._app.scrape(
            url,
            formats=["markdown"],
            actions=actions,
            wait_for=3000,
        )
        markdown = result.markdown or ""
        if not markdown:
            logger.warning("Agentic scrape returned no markdown for %s", url)
        return markdown

    # ── URL Discovery ──────────────────────────────────

    # Broad search terms for map() to catch all policy-related pages.
    # Includes regional compliance frameworks to maximize discovery.
    _MAP_SEARCH_TERMS = (
        "privacy policy terms of service terms of use data processing "
        "data protection cookie policy acceptable use security compliance "
        "GDPR CCPA CPRA DPA PIPEDA PDPA LGPD POPIA "
        "end user license agreement EULA "
        "biometric policy accessibility policy SLA "
        "data processing agreement cookie preferences"
    )

    # Maximum URLs to discover per domain. Set high to avoid
    # silent truncation for large companies with many policy pages.
    _MAP_URL_LIMIT = 200

    # URL path segments that indicate a policy page.
    _POLICY_URL_PATTERNS = re.compile(
        r"(?:privacy|terms|tos|legal|policies|policy|gdpr|ccpa|dpa|"
        r"cookie|acceptable.?use|compliance|security|eula|license|"
        r"data.?processing|data.?protection|user.?agreement)",
        re.IGNORECASE,
    )

    def map_policy_urls(self, domain_url: str) -> list[str]:
        """Discover policy-related URLs on a domain via Firecrawl map.

        Uses broad search terms and filters results by URL path
        segments to maximize recall without returning unrelated pages.
        Returns deduplicated, sorted list of discovered URLs.
        """
        try:
            result = self._app.map(
                domain_url,
                search=self._MAP_SEARCH_TERMS,
                limit=self._MAP_URL_LIMIT,
            )
        except Exception as e:
            logger.warning("map() failed for %s: %s", domain_url, e)
            return []

        seen: set[str] = set()
        urls: list[str] = []
        for link in result.links or []:
            url = link.url if hasattr(link, "url") else str(link)
            if not url or not url.startswith("http"):
                continue
            # Normalize trailing slashes for dedup
            normalized = url.rstrip("/")
            if normalized in seen:
                continue
            # Keep only URLs whose path suggests policy content
            path = urlparse(url).path.lower()
            if self._POLICY_URL_PATTERNS.search(path):
                seen.add(normalized)
                urls.append(url)

        logger.info(
            "map() discovered %d policy URLs for %s",
            len(urls),
            domain_url,
        )
        return sorted(urls)

    # ── Spark AI Agent ───────────────────────────────

    def agent_extract_policy(
        self,
        url: str,
        policy_type: str = "general",
    ) -> str:
        """Use Spark AI agent to navigate a page and extract policy content.

        The agent autonomously clicks buttons, follows links, and finds
        the actual policy text on pages that use JS frameworks or require
        multi-step navigation to reach the policy document.

        This is the most expensive tier — used only when simpler
        approaches return empty or insufficient content.
        """
        prompt = (
            f"Navigate to this page and find the {policy_type} policy document. "
            "If the page has buttons or links to different policies, click on the "
            f"one most relevant to '{policy_type}'. "
            "Extract the FULL text of the policy in Markdown format, preserving "
            "all headings, sections, and legal text. Do not summarize."
        )
        logger.info("Spark agent navigating %s for %s policy", url, policy_type)
        import concurrent.futures

        def _run_agent() -> str:
            resp = self._app.agent(
                urls=[url],
                prompt=prompt,
                schema=PolicyExtraction.model_json_schema(),
                model="spark-1-mini",
                strict_constrain_to_urls=False,
                timeout=60000,
            )
            if resp.data and isinstance(resp.data, dict):
                return resp.data.get("policy_text", "")
            return ""

        # Hard 120s timeout to prevent indefinite hangs
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_run_agent)
            try:
                text = future.result(timeout=120)
            except concurrent.futures.TimeoutError:
                logger.warning(
                    "Spark agent timed out after 120s for %s", url
                )
                return ""
        if text:
            logger.info(
                "Spark agent extracted %d chars from %s",
                len(text), url,
            )
        return text

    # ── PDF Extraction ───────────────────────────────

    def extract_pdf(self, url: str) -> str:
        """Download a PDF from a URL and extract text as Markdown.

        Delegates to shared PDF extraction utility.
        """
        return extract_pdf_from_url(url)

    # ── Iframe Detection ─────────────────────────────

    def extract_iframe_urls(self, url: str) -> list[str]:
        """Scrape a page and detect iframe src URLs that may contain policies.

        Uses httpx to fetch raw HTML and regex to find iframe sources.
        Returns list of absolute iframe URLs (may be empty).
        """
        try:
            with httpx.Client(follow_redirects=True, timeout=20) as client:
                response = client.get(url)
                response.raise_for_status()
                html = response.text
        except Exception as e:
            logger.warning(
                "Failed to fetch HTML for iframe detection at %s: %s",
                url, e,
            )
            return []

        return extract_iframe_urls_from_html(html, url)

    # ── Multi-page Detection ─────────────────────────

    def scrape_with_pagination(self, url: str) -> str:
        """Scrape a policy page and follow pagination links.

        Some companies split policies across multiple pages with
        "Next", "Continue", or numbered pagination. This method
        detects pagination and concatenates all pages.

        Uses two-layer detection:
        1. Markdown-level regex for rendered pagination links
        2. HTML-level fallback that fetches raw HTML and finds
           <a> tags with pagination text/attributes
        """
        all_content: list[str] = []
        visited: set[str] = set()
        current_url = url
        max_pages = 10  # Safety limit to prevent infinite loops

        for page_num in range(max_pages):
            if current_url in visited:
                break
            visited.add(current_url)

            markdown = self.scrape_with_actions(current_url)
            if not markdown.strip():
                break

            all_content.append(markdown)

            # Layer 1: Try Markdown-level pagination detection
            next_url = find_next_page_url(markdown, current_url)

            # Layer 2: HTML fallback if Markdown detection fails
            if not next_url:
                next_url = self._find_next_page_url_html(current_url)

            if not next_url or next_url in visited:
                if page_num == 0:
                    logger.debug(
                        "No pagination detected for %s", url,
                    )
                break
            current_url = next_url
            logger.info(
                "Following pagination link to page %d: %s",
                page_num + 2,
                current_url,
            )

        if len(all_content) > 1:
            logger.info(
                "Concatenated %d pages for %s (%d total chars)",
                len(all_content),
                url,
                sum(len(c) for c in all_content),
            )

        return "\n\n".join(all_content)

    def _find_next_page_url_html(self, url: str) -> str | None:
        """Fallback pagination detection via raw HTML."""
        try:
            with httpx.Client(follow_redirects=True, timeout=15) as client:
                response = client.get(url)
                response.raise_for_status()
                html = response.text
        except Exception as e:
            logger.debug(
                "HTML pagination fallback failed for %s: %s", url, e,
            )
            return None

        return find_next_page_url_html(html, url)
