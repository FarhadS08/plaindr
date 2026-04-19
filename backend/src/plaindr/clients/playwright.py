"""Playwright client — browser-controlled scraping with screenshot audit trail.

Satisfies ScraperProtocol only. Does NOT satisfy AgentProtocol or
UrlDiscoveryProtocol — those remain Firecrawl-exclusive capabilities.

Key advantages over Firecrawl for scraping:
- Full browser control with selector-based waits (not time-based)
- page.content() returns the FULL rendered DOM
- No API cost — retry as many times as needed
- Screenshots on every scrape for compliance audit trail
- JavaScript execution in page context for custom extraction
"""

import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from markdownify import MarkdownConverter
from playwright.sync_api import Page, sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from plaindr.clients._shared import (
    COOKIE_SELECTORS,
    EXPAND_SELECTORS,
    extract_pdf_from_url,
    find_next_page_url,
    find_next_page_url_html,
    is_policy_iframe,
)
from plaindr.config import Settings

logger = logging.getLogger(__name__)


# ── Custom Markdown Converter ─────────────────────────

# Tags to strip entirely — never contain policy content
_STRIP_TAGS = {"script", "style", "nav", "footer", "header", "noscript", "svg"}


class _PolicyMarkdownConverter(MarkdownConverter):
    """Markdown converter tuned for legal documents.

    Strips navigation/scripts while preserving:
    - Heading hierarchy (h1-h6 → # - ######)
    - Tables (→ pipe-table format)
    - Lists (ul/ol → Markdown lists)

    Uses **kwargs for forward-compatibility with markdownify API changes.
    """

    def convert_script(self, el, text, **kwargs):
        return ""

    def convert_style(self, el, text, **kwargs):
        return ""

    def convert_nav(self, el, text, **kwargs):
        return ""

    def convert_footer(self, el, text, **kwargs):
        return ""

    def convert_header(self, el, text, **kwargs):
        return ""

    def convert_noscript(self, el, text, **kwargs):
        return ""

    def convert_svg(self, el, text, **kwargs):
        return ""


def _html_to_markdown(html: str) -> str:
    """Convert HTML to Markdown, stripping non-content elements.

    Uses convert_* method overrides (NOT the strip parameter)
    to remove tags AND their content entirely.
    """
    converter = _PolicyMarkdownConverter(
        heading_style="atx",
        bullets="-",
    )
    markdown = converter.convert(html)

    # Collapse excessive blank lines (common after stripping tags)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    return markdown.strip()


# ── PlaywrightClient ──────────────────────────────────


class PlaywrightClient:
    """Browser-controlled scraper with screenshot audit trail.

    Uses Playwright's sync API with a single Browser instance.
    Each scrape gets a fresh BrowserContext for isolation.

    Usage as a context manager:
        with PlaywrightClient(settings) as pw:
            text = pw.scrape("https://example.com/privacy")
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._headless = settings.playwright_headless
        self._screenshot_dir = Path(settings.playwright_screenshot_dir)
        self._timeout = settings.playwright_timeout_ms
        self._nav_timeout = settings.playwright_navigation_timeout_ms
        self._pw = None
        self._browser = None

    def __enter__(self):
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=self._headless)
        logger.info("Playwright browser launched (headless=%s)", self._headless)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._browser:
            self._browser.close()
        if self._pw:
            self._pw.stop()
        logger.info("Playwright browser closed")
        return False

    def _new_page(self) -> Page:
        """Create a new page in a fresh browser context."""
        if not self._browser:
            raise RuntimeError(
                "PlaywrightClient must be used as a context manager "
                "(with PlaywrightClient(settings) as pw: ...)"
            )
        context = self._browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.set_default_timeout(self._timeout)
        page.set_default_navigation_timeout(self._nav_timeout)
        return page

    def _take_screenshot(self, page: Page, url: str) -> Path | None:
        """Capture full-page screenshot for compliance audit trail."""
        try:
            domain = urlparse(url).netloc
            domain_dir = self._screenshot_dir / domain
            domain_dir.mkdir(parents=True, exist_ok=True)

            timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S_%f")
            path = domain_dir / f"{timestamp}.png"
            page.screenshot(path=str(path), full_page=True)
            logger.debug("Screenshot saved: %s", path)
            return path
        except Exception as e:
            logger.warning("Screenshot failed for %s: %s", url, e)
            return None

    def _dismiss_cookies(self, page: Page) -> None:
        """Try to dismiss cookie consent banners."""
        # Split compound selector and try each independently
        for selector in COOKIE_SELECTORS.split(", "):
            selector = selector.strip()
            if not selector:
                continue
            try:
                element = page.query_selector(selector)
                if element and element.is_visible():
                    element.click()
                    page.wait_for_timeout(300)
                    return  # One click is usually enough
            except Exception:
                continue

    def _expand_sections(self, page: Page) -> None:
        """Click expand/read-more buttons to reveal hidden content."""
        for selector in EXPAND_SELECTORS.split(", "):
            selector = selector.strip()
            if not selector:
                continue
            try:
                elements = page.query_selector_all(selector)
                for el in elements[:10]:  # Safety limit
                    if el.is_visible():
                        el.click()
                        page.wait_for_timeout(200)
            except Exception:
                continue

    def _extract_body_markdown(self, page: Page) -> str:
        """Extract the main body HTML and convert to Markdown.

        Tries to find the <main> element first, falls back to <body>.
        """
        # Prefer <main> or [role="main"] for better signal
        for selector in ["main", "[role='main']", "article", "body"]:
            try:
                el = page.query_selector(selector)
                if el:
                    html = el.inner_html()
                    if html.strip():
                        return _html_to_markdown(html)
            except Exception:
                continue

        # Last resort: full page content
        html = page.content()
        return _html_to_markdown(html)

    # ── ScraperProtocol methods ───────────────────────

    def scrape(self, url: str) -> str:
        """Basic scrape — navigate, wait for load, extract Markdown."""
        page = self._new_page()
        try:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")
            self._take_screenshot(page, url)
            return self._extract_body_markdown(page)
        except PlaywrightTimeout:
            logger.warning("Timeout scraping %s", url)
            # Still try to extract what loaded
            self._take_screenshot(page, url)
            return self._extract_body_markdown(page)
        except Exception as e:
            logger.error("Playwright scrape failed for %s: %s", url, e)
            return ""
        finally:
            page.context.close()

    def scrape_with_actions(self, url: str) -> str:
        """Scrape with cookie dismissal, scrolling, and section expansion."""
        page = self._new_page()
        try:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")

            # Dismiss cookie banners
            self._dismiss_cookies(page)

            # Scroll down to trigger lazy-loaded content
            for _ in range(5):
                page.mouse.wheel(0, 800)
                page.wait_for_timeout(200)

            # Expand collapsed sections
            self._expand_sections(page)

            # Scroll back to top
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(300)

            self._take_screenshot(page, url)
            return self._extract_body_markdown(page)
        except PlaywrightTimeout:
            logger.warning("Timeout during action scrape of %s", url)
            self._take_screenshot(page, url)
            return self._extract_body_markdown(page)
        except Exception as e:
            logger.error(
                "Playwright action scrape failed for %s: %s", url, e,
            )
            return ""
        finally:
            page.context.close()

    def scrape_with_pagination(self, url: str) -> str:
        """Scrape with pagination detection and multi-page concatenation.

        Uses two-layer detection:
        1. Markdown-level regex for rendered pagination links
        2. HTML-level fallback via raw HTML fetch
        """
        all_content: list[str] = []
        visited: set[str] = set()
        current_url = url
        max_pages = 10

        for page_num in range(max_pages):
            if current_url in visited:
                break
            visited.add(current_url)

            markdown = self.scrape_with_actions(current_url)
            if not markdown.strip():
                break

            all_content.append(markdown)

            # Layer 1: Markdown-level pagination detection
            next_url = find_next_page_url(markdown, current_url)

            # Layer 2: HTML fallback
            if not next_url:
                next_url = self._find_next_page_html(current_url)

            if not next_url or next_url in visited:
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

    def extract_pdf(self, url: str) -> str:
        """Download a PDF and extract text. Delegates to shared utility."""
        return extract_pdf_from_url(url)

    def extract_iframe_urls(self, url: str) -> list[str]:
        """Detect iframe URLs via Playwright DOM queries.

        Advantage over httpx+regex: catches JS-injected iframes
        that aren't in the initial HTML source.
        """
        page = self._new_page()
        try:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")

            # Query all iframe elements in the rendered DOM
            iframes = page.query_selector_all("iframe[src]")
            urls: list[str] = []
            for iframe in iframes:
                src = iframe.get_attribute("src")
                if src:
                    absolute = urljoin(url, src)
                    if is_policy_iframe(absolute):
                        urls.append(absolute)

            if urls:
                logger.info(
                    "Found %d policy iframes on %s: %s",
                    len(urls), url, urls,
                )
            return urls
        except Exception as e:
            logger.warning(
                "Iframe detection failed for %s: %s", url, e,
            )
            return []
        finally:
            page.context.close()

    # ── Private helpers ───────────────────────────────

    def _find_next_page_html(self, url: str) -> str | None:
        """HTML-level pagination fallback using httpx."""
        try:
            with httpx.Client(follow_redirects=True, timeout=15) as client:
                response = client.get(url)
                response.raise_for_status()
                return find_next_page_url_html(response.text, url)
        except Exception as e:
            logger.debug(
                "HTML pagination fallback failed for %s: %s", url, e,
            )
            return None
