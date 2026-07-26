"""Crawl-from-main-URL discovery + company resolution.

Pure logic (no FastAPI). Given a company's main URL, use the existing
Firecrawl map() to surface policy URLs on the same registrable domain,
infer each policy's type, and (separately) resolve or infer the company
identity. The user-policies router orchestrates these into endpoints.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Callable, Protocol
from urllib.parse import urlparse

from plaindr.clients.protocol import UrlDiscoveryProtocol
from plaindr.pipelines.feature.url_discovery import (
    _infer_policy_type,
    _normalize_url,
)

logger = logging.getLogger(__name__)

# Cheap model for the one-shot identity inference — same tier the
# query planner uses.
_IDENTITY_MODEL = "claude-haiku-4-5-20251001"


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


# ---------------------------------------------------------------------------
# Company resolution
# ---------------------------------------------------------------------------


@dataclass
class ResolvedCompany:
    matched: bool
    name: str
    slug: str
    category: str
    main_url: str


class _StoreLike(Protocol):
    def list_companies(self) -> list[object]: ...


def _slugify(text: str) -> str:
    """Convert a company name to a URL-safe slug.

    Falls back to ``"company"`` when the name has no slug-able
    characters — never raises, so an odd inferred name can't crash
    the discovery/ingest path.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "company"


def resolve_company(
    store: _StoreLike,
    main_url: str,
    infer: Callable[[str, list[str]], tuple[str, str]],
    discovered_titles: list[str] | None = None,
) -> ResolvedCompany:
    """Match an existing company by registrable domain, else infer name + category.

    ``infer(main_url, titles) -> (name, category)`` is injected so the
    LLM call is mockable in tests.

    Raises ``ValueError`` if ``main_url`` is not an absolute URL.
    """
    parsed = urlparse(main_url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(
            f"main_url must be an absolute URL with scheme and host: {main_url!r}"
        )
    base = _registrable_domain(parsed.netloc)
    canonical_url = f"{parsed.scheme}://{parsed.netloc}"

    for c in store.list_companies():
        c_url = getattr(c, "main_url", None)
        c_name = getattr(c, "name", None)
        c_category = getattr(c, "category", None)
        if (
            c_url
            and c_name
            and c_category
            and _registrable_domain(urlparse(str(c_url)).netloc) == base
        ):
            return ResolvedCompany(
                matched=True,
                name=str(c_name),
                slug=_slugify(str(c_name)),
                category=str(c_category),
                main_url=canonical_url,
            )

    name, category = infer(main_url, discovered_titles or [])
    return ResolvedCompany(
        matched=False,
        name=name,
        slug=_slugify(name),
        category=category,
        main_url=canonical_url,
    )


def _domain_fallback_name(main_url: str) -> str:
    """Derive a readable company name from the domain, e.g. 'Cooltool'."""
    host = urlparse(main_url).netloc.lower().removeprefix("www.")
    label = host.split(".")[0] if host else "company"
    return label.capitalize()


def _call_anthropic_for_identity(
    main_url: str, titles: list[str], settings,
) -> tuple[str, str]:
    """One cheap Anthropic call -> (company_name, category).

    Module-level so tests can monkeypatch it.
    """
    import anthropic

    client = anthropic.Anthropic(
        api_key=settings.anthropic_api_key.get_secret_value()
    )
    prompt = (
        "Given a company's website URL and some of its policy page "
        "titles, return the company's display name and a short product "
        "category (2-3 words). Respond as exactly: NAME | CATEGORY\n\n"
        f"URL: {main_url}\nTitles: {', '.join(titles) or 'none'}"
    )
    msg = client.messages.create(
        model=_IDENTITY_MODEL,
        max_tokens=40,
        messages=[{"role": "user", "content": prompt}],
    )
    text = msg.content[0].text.strip()
    name, _, category = text.partition("|")
    return (
        name.strip() or _domain_fallback_name(main_url),
        category.strip() or "Other",
    )


def infer_company_identity(
    main_url: str, titles: list[str], settings,
) -> tuple[str, str]:
    """Infer (name, category); degrade to a domain-derived name on error."""
    try:
        return _call_anthropic_for_identity(main_url, titles, settings)
    except Exception as exc:
        logger.warning("Company inference failed for %s: %s", main_url, exc)
        return _domain_fallback_name(main_url), "Other"
