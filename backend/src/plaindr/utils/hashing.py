"""MD5 content hashing for deduplication and change detection."""

import hashlib


def md5_hash(content: str) -> str:
    """Generate an MD5 hex digest of the given content string.

    Used as the unique ID for PolicyDocument records.
    Enables deduplication (same content = same hash) and
    weekly change detection (content changed = new hash).
    """
    return hashlib.md5(content.encode("utf-8")).hexdigest()
