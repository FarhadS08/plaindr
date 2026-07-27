"""MD5 content hashing for deduplication and change detection."""

import hashlib
import re


def md5_hash(content: str) -> str:
    """Generate an MD5 hex digest of the given content string.

    Used as the unique ID for PolicyDocument records.
    Enables deduplication (same content = same hash) and
    weekly change detection (content changed = new hash).
    """
    return hashlib.md5(content.encode("utf-8")).hexdigest()


# HTML tags are stripped wholesale before tokenizing so a tag *name*
# (e.g. "div") never leaks into the meaning signature as a token.
_HTML_TAG_RE = re.compile(r"<[^>]+>")
# Everything that isn't a lowercase letter or digit is a separator:
# markdown syntax, punctuation (commas, periods, colons), whitespace, and
# quotes all collapse away. Letters and digits are kept, so real wording
# or numeric changes still change the result.
_NON_MEANING_RE = re.compile(r"[^0-9a-z]+")


def normalize_for_meaning(content: str) -> str:
    """Reduce text to its meaning core — the single source of truth for
    "did the meaning change?".

    Lowercases, removes HTML tags, then drops every non-alphanumeric
    character (punctuation, whitespace, markdown syntax). The result is a
    bare run of letters/digits, invariant to formatting and punctuation
    drift but still sensitive to any word or number change::

        "We collect data, sharing it."  -> "wecollectdatasharingit"
        "We collect data sharing  it"    -> "wecollectdatasharingit"   (same)
        "*Retention*: 30 days"           -> "retention30days"
        "Retention: 90 days"             -> "retention90days"          (differs)
        "$1,000"                          -> "1000"
        "$1000"                          -> "1000"                     (same)

    Used by :func:`semantic_hash` and by the diff engine's document-level
    phantom guard, so both agree on what counts as a real change.

    Note: this assumes ASCII-cleaned input (the scrape pipeline runs
    ``clean_markdown`` first, which normalizes/strips non-ASCII). Any
    residual non-ASCII letters are treated as separators.
    """
    without_tags = _HTML_TAG_RE.sub("", content.lower())
    return _NON_MEANING_RE.sub("", without_tags)


def semantic_hash(content: str) -> str:
    """MD5 of the meaning signature (see :func:`normalize_for_meaning`).

    Two documents with the same semantic_hash are equivalent in meaning
    regardless of formatting or punctuation — the guard against declaring
    a policy "changed" when only the scraper's markdown output varied
    between runs (trailing whitespace, `:to` vs `: to`, `data,sharing`
    vs `data, sharing`, smart quotes, list-bullet drift, …).
    """
    return hashlib.md5(
        normalize_for_meaning(content).encode("utf-8")
    ).hexdigest()
