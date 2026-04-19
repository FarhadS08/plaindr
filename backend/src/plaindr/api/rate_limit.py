"""Per-client sliding-window rate limiter.

Thread-safe, in-memory, process-local. For multi-worker or multi-process
deployments, replace with a Redis-backed limiter. This is a best-effort
last line of defense — real rate limiting should happen at the reverse
proxy (nginx, Cloudflare, etc.).
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class SlidingWindowLimiter:
    """N requests per window-seconds, per client key."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, client_key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            bucket = self._buckets[client_key]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= self.limit:
                raise HTTPException(
                    status_code=429, detail="Rate limit exceeded"
                )
            bucket.append(now)


def client_key(request: Request) -> str:
    """Derive a rate-limit key from the request (IP-based)."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
