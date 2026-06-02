"""Crawl-from-main-URL discovery + company resolution.

Pure logic (no FastAPI). Given a company's main URL, use the existing
Firecrawl map() to surface policy URLs on the same registrable domain,
infer each policy's type, and (separately) resolve or infer the company
identity. The user-policies router orchestrates these into endpoints.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

from plaindr.clients.protocol import UrlDiscoveryProtocol
from plaindr.pipelines.feature.url_discovery import (
    _infer_policy_type,
    _normalize_url,
)


@dataclass
class DiscoveredPolicy:
    """A candidate policy page found on a company's domain."""

    url: str
    policy_type: str
    title: str  # human label derived from type until scraped


_TYPE_LABELS = {
    "privacy": "Privacy Policy",
    "tos": "Terms of Service",
    "security": "Security & Compliance",
    "general": "Policy",
}


def _registrable_domain(netloc: str) -> str:
    """Last two labels of the host (e.g. 'openai.com').

    Good enough for same-company matching without a public-suffix list:
    'policy.openai.com' and 'openai.com' both reduce to 'openai.com'.
    """
    host = netloc.lower().split(":")[0]
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def discover_policies_for_domain(
    firecrawl: UrlDiscoveryProtocol,
    main_url: str,
) -> list[DiscoveredPolicy]:
    """Map a domain and return same-domain, type-tagged policy URLs."""
    parsed = urlparse(main_url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"main_url must be an absolute URL with scheme and host: {main_url!r}")

    origin = f"{parsed.scheme}://{parsed.netloc}"
    base_domain = _registrable_domain(parsed.netloc)

    seen: set[str] = set()
    out: list[DiscoveredPolicy] = []
    for url in (firecrawl.map_policy_urls(origin) or []):
        if _registrable_domain(urlparse(url).netloc) != base_domain:
            continue  # same-domain enforcement
        norm = _normalize_url(url)
        if norm in seen:
            continue
        seen.add(norm)
        ptype = _infer_policy_type(url)
        out.append(DiscoveredPolicy(
            url=url,
            policy_type=ptype,
            title=_TYPE_LABELS.get(ptype, "Policy"),
        ))
    return out
