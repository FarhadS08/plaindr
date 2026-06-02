"""Content refinement — cleaning, MD5 hashing, and dedup."""

import logging
import re
from datetime import date

from plaindr.models.policy import PolicyDocument
from plaindr.pipelines.feature.csv_loader import ScrapingTask
from plaindr.utils.hashing import md5_hash

logger = logging.getLogger(__name__)

# Common cookie / consent banner phrases (case-insensitive)
_COOKIE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"^.*(?:accept\s+(?:all\s+)?cookies|cookie\s+(?:policy|settings|preferences)|"
        r"we\s+use\s+cookies|by\s+continuing|manage\s+consent).*$",
        re.IGNORECASE | re.MULTILINE,
    ),
]

# Navigation / footer noise
_NAV_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"^.*(?:skip\s+to\s+(?:main\s+)?content|"
        r"back\s+to\s+top|©\s*\d{4}).*$",
        re.IGNORECASE | re.MULTILINE,
    ),
    # Language-picker dropdowns (common on OpenAI, Meta, Google policy pages)
    # where every available language is concatenated into one run-on string:
    #   "Select language English (United States)Armenianbosanski…"
    # Strip the entire line — these never appear in the body of a policy.
    re.compile(
        r"^.*\bSelect\s+language\b.*$",
        re.IGNORECASE | re.MULTILINE,
    ),
    # Second form of language-picker garbage: the line AFTER "Select
    # language" concatenates every locale name with no spaces, producing
    # a 30+ character run of letters. No legitimate English word reaches
    # that length, so a line containing such a run is always dictionary
    # salad from a concatenated dropdown.
    re.compile(r"^.*[A-Za-z]{30,}.*$", re.MULTILINE),
    # Header/footer logo wrapped in a link — Perplexity, Framer, etc. emit
    #   [![](https://.../logo.png)](https://...) [Blog](…) [Research](…)
    # as the first content line. Drop any line containing an image-in-link.
    re.compile(r"^.*\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\).*$", re.MULTILINE),
    # Nav link strips — 3 or more [text](url) pairs on a single line with
    # no other substantive content. Protects against the "Blog | Research |
    # Careers | Contact" style header that prefixes some policies.
    re.compile(
        r"^\s*(?:\[[^\]\n]+\]\([^)\n]+\)\s*){3,}\s*$",
        re.MULTILINE,
    ),
    # Solo nav-link lines — a single [text](url) where the link text
    # starts with a directional verb ("Go to", "Back to", "Skip to",
    # "Return to", "Continue to"). Lovable/etc. emit "[Go to dashboard]
    # (https://...)" as the first line and silently rewrite it across
    # scrapes ("dashboard" -> "homepage"), producing phantom diffs.
    # Edge-only (first/last 20 lines) keeps in-body references safe.
    re.compile(
        r"^\s*\[(?:Go|Back|Skip|Return|Continue)\s+to\s+[^\]\n]+\]"
        r"\([^)\n]+\)\s*$",
        re.MULTILINE | re.IGNORECASE,
    ),
]

# Widget / chat / cookie-banner chrome that leaks mid-document on some
# sites (Canva, Chatbase, CapCut). Unlike _COOKIE_PATTERNS these are
# specific enough to strip globally — the phrases don't appear in
# legitimate policy body text.
_WIDGET_PATTERNS: list[re.Pattern[str]] = [
    # Stripe embed marker left behind by Firecrawl
    re.compile(r"^.*StripeM-Inner.*$", re.MULTILINE),
    # Cookie-consent tier labels emitted as standalone lines by Iubenda,
    # OneTrust, cookiebot, etc.
    re.compile(
        r"^\s*#{0,6}\s*(?:Strictly\s+Necessary|Strictly\s+necessary|"
        r"Analytics|Marketing\s+Performance|Performance|Functional|"
        r"Targeting)\s+[Cc]ookies(?:\s*\(always\s+active\))?\s*$",
        re.MULTILINE,
    ),
    # Cookie-banner save/close button
    re.compile(r"^\s*Save\s+settings\s*Close\s*$", re.MULTILINE | re.IGNORECASE),
    # Chat-widget CTAs (Intercom, Drift, Chatbase's own widget)
    re.compile(
        r"^\s*Hey!\s+(?:Want\s+to|Need\s+help|Have\s+a\s+question)[^\n]*$",
        re.MULTILINE | re.IGNORECASE,
    ),
    # Language-picker list entries — bullet whose link points at a
    # locale path like /fr_fr/... or /zh-tw/... These are Canva/Meta/
    # Google style and never appear in policy bodies.
    re.compile(
        r"^\s*-\s*\[[^\]]*\]\(https?://[^)]+/[a-z]{2}[_-][a-z]{2,3}/[^)]*\)\s*$",
        re.MULTILINE,
    ),
    # Empty-label locale entries Canva emits for CJK/RTL languages:
    # "- [ ()](https://...)"
    re.compile(
        r"^\s*-\s*\[\s*\(\s*\)\s*\]\([^)]+\)\s*$",
        re.MULTILINE,
    ),
]


# Unicode → ASCII replacements for characters commonly found in
# legal and policy documents.  Normalizing instead of stripping
# preserves semantic content (e.g., bullet lists, quoted clauses).
_UNICODE_REPLACEMENTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"[\u2018\u2019\u201A\u201B]"), "'"),   # smart single quotes
    (re.compile(r"[\u201C\u201D\u201E\u201F]"), '"'),    # smart double quotes
    (re.compile(r"[\u2013\u2014]"), "-"),                 # en-dash, em-dash
    (re.compile(r"\u2026"), "..."),                       # ellipsis
    (re.compile(r"\u2022"), "- "),                        # bullet
    (re.compile(r"\u00A7"), "Section "),                  # section sign
    (re.compile(r"\u00A9"), "(c)"),                       # copyright
    (re.compile(r"\u00AE"), "(R)"),                       # registered
    (re.compile(r"\u2122"), "(TM)"),                      # trademark
    (re.compile(r"\u00B7"), "- "),                        # middle dot (used as bullet)
    (re.compile(r"\u00A0"), " "),                         # non-breaking space
]


def _normalize_unicode_punctuation(text: str) -> str:
    """Replace common Unicode punctuation with ASCII equivalents."""
    for pattern, replacement in _UNICODE_REPLACEMENTS:
        text = pattern.sub(replacement, text)
    return text


def clean_markdown(raw_markdown: str) -> str:
    """Clean scraped Markdown content.

    Pipeline:
    1. Strip cookie/consent banner lines (first/last 20 lines only)
    2. Strip navigation/footer noise (first/last 20 lines only)
    3. Strip widget/chat/locale-picker chrome (globally — safe patterns)
    4. Unescape Firecrawl-style backslash escapes on - and .
    5. Canonicalize bare-URL link syntax (<url> -> [url](url))
    6. Drop trailing slashes inside markdown link URLs
    7. Drop empty heading lines
    8. Strip trailing whitespace on every line
    9. Normalize non-ASCII characters (keep basic punctuation)
    10. Collapse redundant blank lines and multiple spaces

    Cookie/nav patterns are applied ONLY to the first/last 20 lines
    to preserve legitimate mid-document text that happens to contain
    phrases like "by continuing". Widget patterns are specific enough
    to run globally without false positives.

    Steps 4-8 are the anti-phantom-diff pass: Firecrawl's markdown
    output drifts between scrapes (trailing whitespace, backslash
    escapes on dashes/periods, <url> vs [url](url), trailing slashes)
    producing hash changes for semantically identical content. Each
    rule normalizes to one canonical form so repeat scrapes hash
    identically.
    """
    text = raw_markdown

    # 1 + 2: Edge-only noise (cookie banners and nav chrome live at
    # page edges; applying globally would strip legitimate clauses)
    text = _strip_edge_noise(text, _COOKIE_PATTERNS + _NAV_PATTERNS, edge_lines=20)

    # 3: Global widget/chrome stripping — these patterns are specific
    # enough to apply mid-document (StripeM-Inner, cookie tier labels,
    # chat-widget CTAs, language-picker bullets)
    for pattern in _WIDGET_PATTERNS:
        text = pattern.sub("", text)

    # 4: Unescape Firecrawl's markdown escape drift. Some scrapes emit
    # "\- item" or "1\. Section" (backslash before dash/period), the
    # next scrape of the same source emits the unescaped form. Strip
    # the escape so both hash identically. Only targets characters
    # markdown doesn't require escaping in normal prose.
    text = re.sub(r"\\([-.])", r"\1", text)

    # 5: Canonicalize autolinks <https://...> to [url](url) form.
    # Firecrawl alternates between the two representations for the
    # same source URL.
    text = re.sub(
        r"<(https?://[^>\s]+)>",
        lambda m: f"[{m.group(1)}]({m.group(1)})",
        text,
    )

    # 6: Strip trailing slash inside markdown link URLs when followed
    # immediately by the closing paren. "[x](https://a.com/)" and
    # "[x](https://a.com)" resolve identically; pick the no-slash
    # form as canonical.
    text = re.sub(
        r"(\]\(https?://[^)\s]+?)/(\))",
        r"\1\2",
        text,
    )

    # 7: Drop empty heading lines (Canva emits a bare "## " when the
    # source HTML has an empty <h2>; the next scrape drops the whole
    # line). Normalize by always dropping.
    text = re.sub(r"^#{1,6}\s*$\n?", "", text, flags=re.MULTILINE)

    # 8: Strip trailing whitespace per line — the single biggest
    # source of phantom diffs on Chatbase and similar sites.
    text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)

    # 9: Normalize non-ASCII — preserve common Unicode punctuation
    # (smart quotes, em-dashes, bullets, section/copyright symbols)
    # by replacing with ASCII; strip anything else.
    text = _normalize_unicode_punctuation(text)
    stripped_chars = re.findall(r"[^\x00-\x7F]+", text)
    if stripped_chars:
        logger.debug(
            "Stripping %d non-ASCII sequences after normalization",
            len(stripped_chars),
        )
    text = re.sub(r"[^\x00-\x7F]+", "", text)

    # 10: Collapse 3+ newlines to 2, multiple intra-line spaces to 1
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[^\S\n]+", " ", text)

    return text.strip()


def _strip_edge_noise(
    text: str,
    patterns: list[re.Pattern[str]],
    edge_lines: int = 20,
) -> str:
    """Apply noise-stripping patterns only to the first/last N lines.

    This prevents legitimate mid-document policy text from being
    removed by patterns designed to catch cookie banners and
    navigation elements that only appear at page edges.
    """
    lines = text.split("\n")
    if len(lines) <= edge_lines * 2:
        # Document is short enough that all lines are "edge" lines
        for pattern in patterns:
            text = pattern.sub("", text)
        return text

    head = "\n".join(lines[:edge_lines])
    body = "\n".join(lines[edge_lines:-edge_lines])
    tail = "\n".join(lines[-edge_lines:])

    for pattern in patterns:
        head = pattern.sub("", head)
        tail = pattern.sub("", tail)

    return head + "\n" + body + "\n" + tail


def build_policy_document(
    task: ScrapingTask,
    cleaned_content: str,
    *,
    effective_date: date | None = None,
) -> PolicyDocument:
    """Create a PolicyDocument from a scraping task and cleaned
    content.

    The document ID is the MD5 hash of the cleaned content,
    enabling deduplication and weekly change detection.
    """
    return PolicyDocument(
        id=md5_hash(cleaned_content),
        author_id=task.company_id,
        title=task.company_name,
        policy_type=task.policy_type,
        source_url=task.policy_url,
        content=cleaned_content,
        effective_date=effective_date,
    )


def is_duplicate(
    new_doc: PolicyDocument,
    existing_ids: set[str],
) -> bool:
    """Check if a policy document is a duplicate by MD5 hash."""
    return new_doc.id in existing_ids
