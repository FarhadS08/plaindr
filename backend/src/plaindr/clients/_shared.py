"""Shared utilities for scraper clients (Playwright + Firecrawl).

Contains logic that both scraping backends need:
- CSS selectors for cookie consent and expand/collapse
- Iframe URL filtering (policy vs. tracking)
- Markdown-level pagination detection
- PDF download + PyMuPDF text extraction
"""

import logging
import re
import time
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger(__name__)


# ── CSS selectors shared by both clients ──────────────

# Common cookie-consent / popup selectors across policy sites
COOKIE_SELECTORS = (
    "[id*='cookie'] button, [class*='cookie'] button, "
    "[id*='consent'] button, [class*='consent'] button, "
    ".cc-btn, #onetrust-accept-btn-handler, .accept-cookies, "
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, "
    ".cky-btn-accept, #accept-cookie-notification"
)

# Selectors for expandable / collapsible policy sections
EXPAND_SELECTORS = (
    "[class*='read-more'], [class*='show-more'], "
    "[class*='expand'], details summary, "
    ".accordion-toggle, [aria-expanded='false']"
)


# ── Iframe URL filtering ─────────────────────────────

# Domains that host tracking/widget iframes, never policy content
_SKIP_IFRAME_DOMAINS = {
    "google.com", "googletagmanager.com", "facebook.com",
    "twitter.com", "youtube.com", "vimeo.com", "doubleclick.net",
    "googlesyndication.com", "analytics", "recaptcha",
}

# Keywords in path or domain that indicate policy content
_POLICY_IFRAME_KEYWORDS = [
    "privacy", "terms", "policy", "legal", "dpa",
    "compliance", "gdpr", "agreement", "license",
]


def is_policy_iframe(url: str) -> bool:
    """Check if an iframe URL likely contains policy content.

    Filters out known tracking/analytics iframes and checks
    for policy-related keywords in the URL path or domain.
    """
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    if any(skip in domain for skip in _SKIP_IFRAME_DOMAINS):
        return False

    path = parsed.path.lower()
    return any(kw in path or kw in domain for kw in _POLICY_IFRAME_KEYWORDS)


# ── Markdown pagination detection ─────────────────────

# Patterns that indicate a "next page" link in Markdown content.
NEXT_PAGE_PATTERNS = re.compile(
    r'\[(?:next|continue|next page|read more|page \d+)\]\((https?://[^\)]+)\)',
    re.IGNORECASE,
)


def find_next_page_url(markdown: str, current_url: str) -> str | None:
    """Extract the next page URL from pagination links in Markdown.

    Only returns URLs on the same domain to avoid leaving the site.
    """
    match = NEXT_PAGE_PATTERNS.search(markdown)
    if match:
        next_url = match.group(1)
        current_domain = urlparse(current_url).netloc
        next_domain = urlparse(next_url).netloc
        if current_domain == next_domain:
            return next_url
    return None


def find_next_page_url_html(html: str, current_url: str) -> str | None:
    """Fallback pagination detection via raw HTML.

    Checks for rel="next" and <a> tags with pagination text.
    Only returns URLs on the same domain.
    """
    next_link_pattern = re.compile(
        r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>'
        r'[^<]*(?:next|continue|next\s*page|page\s*\d+|'
        r'read\s*more|&#8250;|&#x203A;|&raquo;|&gt;|'
        r'&rsaquo;|\u203A|\u00BB)[^<]*</a>',
        re.IGNORECASE,
    )
    rel_next_pattern = re.compile(
        r'<(?:a|link)[^>]+rel=["\']next["\'][^>]+href=["\']([^"\']+)["\']',
        re.IGNORECASE,
    )

    current_domain = urlparse(current_url).netloc

    for pattern in [rel_next_pattern, next_link_pattern]:
        match = pattern.search(html)
        if match:
            href = match.group(1)
            absolute = urljoin(current_url, href)
            if urlparse(absolute).netloc == current_domain:
                return absolute

    return None


# ── PDF extraction ────────────────────────────────────

# PDF download timeout — large DPA/security PDFs can be 10-50MB.
_PDF_TIMEOUT = 120  # seconds
_PDF_MAX_RETRIES = 3
_PDF_RETRY_BASE_DELAY = 2.0


def extract_pdf_from_url(url: str) -> str:
    """Download a PDF from a URL and extract text as Markdown.

    Uses PyMuPDF (fitz) to extract text, preserving basic structure.
    Retries on transient failures. Returns empty string on failure.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.error(
            "PyMuPDF (fitz) not installed — cannot extract PDF from %s. "
            "Install with: uv add pymupdf",
            url,
        )
        return ""

    last_error: Exception | None = None
    for attempt in range(1, _PDF_MAX_RETRIES + 1):
        try:
            logger.info(
                "Downloading PDF from %s (attempt %d/%d)",
                url, attempt, _PDF_MAX_RETRIES,
            )
            with httpx.Client(
                follow_redirects=True,
                timeout=_PDF_TIMEOUT,
            ) as client:
                response = client.get(url)
                response.raise_for_status()

            doc = fitz.open(stream=response.content, filetype="pdf")
            pages: list[str] = []
            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text("text")
                if text.strip():
                    pages.append(text.strip())
            doc.close()

            if not pages:
                logger.warning(
                    "PDF at %s contained no extractable text", url,
                )
                return ""

            markdown = "\n\n---\n\n".join(pages)
            logger.info(
                "Extracted %d chars from %d-page PDF at %s",
                len(markdown),
                len(pages),
                url,
            )
            return markdown

        except Exception as e:
            last_error = e
            logger.warning(
                "PDF extraction attempt %d/%d failed for %s: %s",
                attempt, _PDF_MAX_RETRIES, url, e,
            )
            if attempt < _PDF_MAX_RETRIES:
                delay = _PDF_RETRY_BASE_DELAY * (2 ** (attempt - 1))
                time.sleep(delay)

    logger.error(
        "PDF extraction exhausted all %d retries for %s (last error: %s)",
        _PDF_MAX_RETRIES, url, last_error,
    )
    return ""


# ── HTML iframe extraction helper ─────────────────────

_IFRAME_SRC_PATTERN = re.compile(
    r'<iframe[^>]+src=["\']([^"\']+)["\']',
    re.IGNORECASE,
)


def extract_iframe_urls_from_html(
    html: str,
    page_url: str,
) -> list[str]:
    """Extract policy-related iframe URLs from raw HTML.

    Resolves relative URLs and filters out tracking/widget iframes.
    """
    matches = _IFRAME_SRC_PATTERN.findall(html)
    urls: list[str] = []
    for src in matches:
        absolute = urljoin(page_url, src)
        if is_policy_iframe(absolute):
            urls.append(absolute)

    if urls:
        logger.info(
            "Found %d policy-related iframes on %s: %s",
            len(urls), page_url, urls,
        )
    return urls
