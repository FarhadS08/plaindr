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


# Markdown syntax tokens to strip when computing a semantic hash:
# link/image brackets, emphasis, heading hashes, list bullets, pipes,
# backticks, html tags, and residual backslash escapes.
_SEMANTIC_STRIP = re.compile(
    r"[\[\]()`*_~>|#-]|"
    r"<[^>]+>|"
    r"\\[^\w\s]",
)


def semantic_hash(content: str) -> str:
    """MD5 of content reduced to its semantic core.

    Strips markdown syntax, collapses all whitespace, and lowercases
    before hashing. Two documents with the same semantic_hash are
    equivalent in meaning regardless of formatting drift — useful as
    a guard against declaring a policy "changed" when only the
    scraper's markdown output varied between runs.
    """
    normalized = _SEMANTIC_STRIP.sub(" ", content).lower()
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return hashlib.md5(normalized.encode("utf-8")).hexdigest()
