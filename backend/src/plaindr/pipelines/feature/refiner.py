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
    3. Normalize non-ASCII characters (keep basic punctuation)
    4. Collapse redundant blank lines
    5. Strip leading/trailing whitespace

    Cookie/nav patterns are ONLY applied to the edges of the document
    (first and last 20 lines) to prevent stripping legitimate policy
    text that happens to contain phrases like "by continuing".
    """
    text = raw_markdown

    # 1 + 2: Strip noise lines — only in first/last 20 lines
    # Cookie banners and nav elements live at page edges, never
    # in the middle of a policy document. Applying patterns
    # globally was stripping legitimate clauses like
    # "By continuing to use our services, you consent..."
    text = _strip_edge_noise(text, _COOKIE_PATTERNS + _NAV_PATTERNS, edge_lines=20)

    # 3: Normalize non-ASCII — preserve common Unicode punctuation
    # found in legal/policy documents (smart quotes, em-dashes,
    # bullets, section signs, copyright symbols) by replacing them
    # with ASCII equivalents. Only strip truly exotic characters.
    text = _normalize_unicode_punctuation(text)
    stripped_chars = re.findall(r"[^\x00-\x7F]+", text)
    if stripped_chars:
        logger.debug(
            "Stripping %d non-ASCII sequences after normalization",
            len(stripped_chars),
        )
    text = re.sub(r"[^\x00-\x7F]+", "", text)

    # 4: Collapse 3+ newlines into 2 (preserve paragraph breaks)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # 5: Collapse multiple spaces into one (preserve newlines)
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
