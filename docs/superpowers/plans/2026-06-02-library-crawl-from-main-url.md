# Library Crawl-From-Main-URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user submit a company's main URL in the Library; our crawler discovers the policy pages, the user picks which to add, and each selection is scraped (with a cinematic SSE progress view) and promoted into the shared canonical corpus.

**Architecture:** Two backend endpoints on the existing FastAPI `user-policies` router — `POST /discover` (fast, synchronous, JWT via tRPC proxy) returns candidate policy URLs + a matched-or-inferred company; `POST /ingest-stream` (Server-Sent Events, called browser→FastAPI directly with the Supabase Bearer token) scrapes the selected policies one by one, promotes each into the canonical corpus (reusing `_upsert_and_sync`), and streams per-policy progress frames. The frontend `SubmitPolicyDialog` becomes an `input → review → ingesting → done` state machine with an animated `IngestProgress` scene.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic / pytest (backend); TypeScript / tRPC / React / framer-motion / vitest (frontend); Firecrawl `map()` for discovery; Anthropic for company inference.

---

## File Structure

**Backend (create):**
- `backend/src/plaindr/pipelines/feature/company_discovery.py` — discovery + company-resolution logic (pure, testable, no FastAPI imports).
- `backend/tests/test_pipelines/feature/test_company_discovery.py` — unit tests for the above.
- `backend/tests/test_api/test_user_policies_discover.py` — discover endpoint tests.
- `backend/tests/test_api/test_user_policies_ingest.py` — ingest-stream endpoint tests.

**Backend (modify):**
- `backend/src/plaindr/models/company.py` — add `origin_user_id` field.
- `backend/src/plaindr/clients/policy_store.py` — persist/parse `origin_user_id` in `companies.yaml`.
- `backend/src/plaindr/api/routers/user_policies.py` — add `discover` + `ingest-stream` endpoints and their models.

**Server (modify):**
- `server/routers.ts` — add `userPolicies.discover` tRPC procedure.

**Frontend (create):**
- `client/src/components/dashboard/IngestProgress.tsx` — cinematic SSE progress scene.

**Frontend (modify):**
- `client/src/lib/api.ts` — add `ingestPoliciesStream` SSE client.
- `client/src/lib/trpc` usage in dialog — call `userPolicies.discover`.
- `client/src/components/dashboard/SubmitPolicyDialog.tsx` — rebuild as a 4-state machine.

---

## Phase A — Backend discovery + company resolution

### Task A1: Domain policy-URL discovery (pure function)

**Files:**
- Create: `backend/src/plaindr/pipelines/feature/company_discovery.py`
- Test: `backend/tests/test_pipelines/feature/test_company_discovery.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_pipelines/feature/test_company_discovery.py
"""Tests for crawl-from-main-URL discovery + company resolution."""

from plaindr.pipelines.feature.company_discovery import (
    DiscoveredPolicy,
    discover_policies_for_domain,
)


class _FakeFirecrawl:
    def __init__(self, urls: list[str]) -> None:
        self._urls = urls

    def map_policy_urls(self, domain_url: str) -> list[str]:
        return self._urls


class TestDiscoverPoliciesForDomain:
    def test_returns_typed_policies_same_domain_only(self):
        fc = _FakeFirecrawl([
            "https://openai.com/policies/privacy-policy",
            "https://openai.com/policies/terms-of-use",
            "https://evil.com/policies/privacy",  # off-domain → dropped
        ])
        out = discover_policies_for_domain(fc, "https://openai.com")
        urls = [p.url for p in out]
        assert "https://openai.com/policies/privacy-policy" in urls
        assert "https://openai.com/policies/terms-of-use" in urls
        assert all("evil.com" not in u for u in urls)

    def test_infers_policy_type(self):
        fc = _FakeFirecrawl(["https://x.com/legal/privacy"])
        out = discover_policies_for_domain(fc, "https://x.com")
        assert out[0].policy_type == "privacy"

    def test_dedups_normalized_urls(self):
        fc = _FakeFirecrawl([
            "https://x.com/privacy",
            "https://x.com/privacy/",  # trailing slash → same
        ])
        out = discover_policies_for_domain(fc, "https://x.com")
        assert len(out) == 1

    def test_subdomain_of_same_registrable_domain_allowed(self):
        # policy.openai.com is the same registrable domain as openai.com
        fc = _FakeFirecrawl(["https://policy.openai.com/privacy"])
        out = discover_policies_for_domain(fc, "https://openai.com")
        assert len(out) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_pipelines/feature/test_company_discovery.py -v`
Expected: FAIL — `ModuleNotFoundError: company_discovery`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/src/plaindr/pipelines/feature/company_discovery.py
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
    origin = f"{urlparse(main_url).scheme}://{urlparse(main_url).netloc}"
    base_domain = _registrable_domain(urlparse(main_url).netloc)

    seen: set[str] = set()
    out: list[DiscoveredPolicy] = []
    for url in firecrawl.map_policy_urls(origin):
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_pipelines/feature/test_company_discovery.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/plaindr/pipelines/feature/company_discovery.py backend/tests/test_pipelines/feature/test_company_discovery.py
git commit -m "feat(library): same-domain policy URL discovery from a main URL"
```

---

### Task A2: Company resolution (match existing, else infer via LLM)

**Files:**
- Modify: `backend/src/plaindr/pipelines/feature/company_discovery.py`
- Test: `backend/tests/test_pipelines/feature/test_company_discovery.py`

- [ ] **Step 1: Write the failing test (append to the test file)**

```python
from plaindr.pipelines.feature.company_discovery import (
    ResolvedCompany,
    resolve_company,
)


class _FakeStore:
    def __init__(self, companies):
        self._companies = companies

    def get_company_by_name(self, name):
        for c in self._companies:
            if c.name.lower() == name.lower():
                return c
        return None

    def list_companies(self):
        return self._companies


class _FakeCompany:
    def __init__(self, name, slug_domain):
        from uuid import uuid4
        self.id = uuid4()
        self.name = name
        self.category = "AI Chat"
        self.main_url = f"https://{slug_domain}"


class TestResolveCompany:
    def test_matches_existing_by_domain(self):
        existing = _FakeCompany("OpenAI", "openai.com")
        store = _FakeStore([existing])
        out = resolve_company(
            store, main_url="https://openai.com",
            infer=lambda *a, **k: ("WRONG", "WRONG"),
        )
        assert out.matched is True
        assert out.name == "OpenAI"
        assert out.slug == "openai"

    def test_infers_when_no_match(self):
        store = _FakeStore([])
        out = resolve_company(
            store, main_url="https://newco.ai",
            infer=lambda main_url, titles: ("NewCo", "AI Agents"),
        )
        assert out.matched is False
        assert out.name == "NewCo"
        assert out.category == "AI Agents"
        assert out.slug == "newco"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_pipelines/feature/test_company_discovery.py::TestResolveCompany -v`
Expected: FAIL — `ImportError: ResolvedCompany`.

- [ ] **Step 3: Write minimal implementation (append to company_discovery.py)**

```python
import re
from typing import Callable, Protocol
from urllib.parse import urlparse


@dataclass
class ResolvedCompany:
    matched: bool
    name: str
    slug: str
    category: str
    main_url: str


class _StoreLike(Protocol):
    def list_companies(self) -> list: ...


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "company"


def resolve_company(
    store: _StoreLike,
    main_url: str,
    infer: Callable[[str, list[str]], tuple[str, str]],
    discovered_titles: list[str] | None = None,
) -> ResolvedCompany:
    """Match an existing company by domain, else infer name + category.

    `infer(main_url, titles) -> (name, category)` is injected so the
    LLM call is mockable in tests.
    """
    base = _registrable_domain(urlparse(main_url).netloc)
    for c in store.list_companies():
        cu = getattr(c, "main_url", None)
        if cu and _registrable_domain(urlparse(str(cu)).netloc) == base:
            return ResolvedCompany(
                matched=True, name=c.name, slug=_slugify(c.name),
                category=c.category,
                main_url=f"{urlparse(main_url).scheme}://"
                         f"{urlparse(main_url).netloc}",
            )
    name, category = infer(main_url, discovered_titles or [])
    return ResolvedCompany(
        matched=False, name=name, slug=_slugify(name), category=category,
        main_url=f"{urlparse(main_url).scheme}://{urlparse(main_url).netloc}",
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_pipelines/feature/test_company_discovery.py::TestResolveCompany -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/plaindr/pipelines/feature/company_discovery.py backend/tests/test_pipelines/feature/test_company_discovery.py
git commit -m "feat(library): resolve-or-infer company identity from main URL"
```

---

### Task A3: LLM company inference helper

**Files:**
- Modify: `backend/src/plaindr/pipelines/feature/company_discovery.py`
- Test: `backend/tests/test_pipelines/feature/test_company_discovery.py`

- [ ] **Step 1: Write the failing test (append)**

```python
from plaindr.pipelines.feature.company_discovery import infer_company_identity


class TestInferCompanyIdentity:
    def test_falls_back_to_domain_on_error(self, monkeypatch):
        # Force the LLM call to raise; helper must degrade gracefully.
        import plaindr.pipelines.feature.company_discovery as mod

        def _boom(*a, **k):
            raise RuntimeError("no credits")

        monkeypatch.setattr(mod, "_call_anthropic_for_identity", _boom)
        name, category = infer_company_identity(
            "https://cooltool.ai", ["Privacy Policy"], settings=object(),
        )
        assert name == "Cooltool"  # derived from domain
        assert category == "Other"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_pipelines/feature/test_company_discovery.py::TestInferCompanyIdentity -v`
Expected: FAIL — `ImportError: infer_company_identity`.

- [ ] **Step 3: Write minimal implementation (append)**

```python
import logging

logger = logging.getLogger(__name__)


def _domain_fallback_name(main_url: str) -> str:
    host = urlparse(main_url).netloc.lower().removeprefix("www.")
    label = host.split(".")[0] if host else "company"
    return label.capitalize()


def _call_anthropic_for_identity(
    main_url: str, titles: list[str], settings,
) -> tuple[str, str]:
    """One cheap Anthropic call → (company_name, category).

    Kept as a module-level function so tests can monkeypatch it.
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
        model=settings.anthropic_model,
        max_tokens=40,
        messages=[{"role": "user", "content": prompt}],
    )
    text = msg.content[0].text.strip()
    name, _, category = text.partition("|")
    return name.strip() or _domain_fallback_name(main_url), (
        category.strip() or "Other"
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
```

> NOTE: confirm the settings attribute for the model name. `config.py` exposes `anthropic_api_key`; grep for the model field (e.g. `anthropic_model`) and use the actual name. If none exists, hardcode `"claude-haiku-4-5-20251001"` for this cheap call.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_pipelines/feature/test_company_discovery.py::TestInferCompanyIdentity -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/plaindr/pipelines/feature/company_discovery.py backend/tests/test_pipelines/feature/test_company_discovery.py
git commit -m "feat(library): LLM company-identity inference with domain fallback"
```

---

### Task A4: `POST /api/user-policies/discover` endpoint

**Files:**
- Modify: `backend/src/plaindr/api/routers/user_policies.py`
- Test: `backend/tests/test_api/test_user_policies_discover.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_api/test_user_policies_discover.py
"""Tests for the /api/user-policies/discover endpoint."""

import pytest
from fastapi.testclient import TestClient


# Reuse the app + dependency-override fixtures the existing
# user-policies tests use. If a conftest fixture `client` already
# exists, use it; otherwise build one mirroring test_user_policies.py.
# This test assumes a `discover_client` fixture that:
#   - enables the feature flag
#   - overrides _require_user to return "user-1"
#   - injects a fake store with no companies
#   - injects a fake firecrawl returning two same-domain policy URLs

def test_discover_returns_company_and_policies(discover_client: TestClient):
    resp = discover_client.post(
        "/api/user-policies/discover",
        json={"url": "https://openai.com", "organization_id": None},
        headers={"Authorization": "Bearer test"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["company"]["name"]
    assert body["company"]["matched"] in (True, False)
    assert len(body["policies"]) >= 1
    assert all(p["url"].startswith("https://openai.com") for p in body["policies"])


def test_discover_rejects_non_http(discover_client: TestClient):
    resp = discover_client.post(
        "/api/user-policies/discover",
        json={"url": "ftp://openai.com", "organization_id": None},
        headers={"Authorization": "Bearer test"},
    )
    assert resp.status_code == 400
```

> Build the `discover_client` fixture in this test file modeled on the existing user-policies endpoint tests (same dependency-override pattern: `app.dependency_overrides[_require_user] = lambda: "user-1"`, feature-flag settings, fake store, fake firecrawl). Inspect `backend/tests/test_api/` (or wherever the existing user-policies tests live) for the exact fixture style and copy it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_api/test_user_policies_discover.py -v`
Expected: FAIL — 404 (endpoint not defined).

- [ ] **Step 3: Add the endpoint to `user_policies.py`**

Add models near the other request/response models:

```python
class DiscoverRequest(BaseModel):
    url: str = Field(min_length=1, max_length=_MAX_URL_LENGTH)
    organization_id: str | None = None


class DiscoveredPolicyItem(BaseModel):
    url: str
    policy_type: str
    title: str


class CompanyIdentity(BaseModel):
    matched: bool
    name: str
    slug: str
    category: str
    main_url: str


class DiscoverResponse(BaseModel):
    company: CompanyIdentity
    policies: list[DiscoveredPolicyItem]
```

Add a Firecrawl dependency + the endpoint:

```python
def _get_firecrawl(settings: Settings = Depends(get_settings)):
    from plaindr.clients.firecrawl import FirecrawlClient
    return FirecrawlClient(settings)


@router.post(
    "/discover",
    response_model=DiscoverResponse,
    dependencies=[Depends(_require_feature_enabled)],
)
def discover_policies(
    body: DiscoverRequest,
    user_id: str = Depends(_require_user),
    settings: Settings = Depends(get_settings),
    table: SupabaseTableClient = Depends(_get_table_client),
    store: PolicyStore = Depends(get_policy_store),
    firecrawl=Depends(_get_firecrawl),
) -> DiscoverResponse:
    """Crawl a company's main URL and return candidate policy pages."""
    from plaindr.pipelines.feature.company_discovery import (
        discover_policies_for_domain,
        infer_company_identity,
        resolve_company,
    )

    url = _validate_url(body.url)
    _hourly_limiter.check(f"user:{user_id}")
    if body.organization_id and not table.is_org_member(
        user_id, body.organization_id
    ):
        raise HTTPException(403, "Not a member of this organization")

    discovered = discover_policies_for_domain(firecrawl, url)
    company = resolve_company(
        store,
        main_url=url,
        infer=lambda mu, titles: infer_company_identity(mu, titles, settings),
        discovered_titles=[d.title for d in discovered],
    )
    return DiscoverResponse(
        company=CompanyIdentity(
            matched=company.matched, name=company.name, slug=company.slug,
            category=company.category, main_url=company.main_url,
        ),
        policies=[
            DiscoveredPolicyItem(
                url=d.url, policy_type=d.policy_type, title=d.title
            )
            for d in discovered
        ],
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_api/test_user_policies_discover.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/plaindr/api/routers/user_policies.py backend/tests/test_api/test_user_policies_discover.py
git commit -m "feat(library): /discover endpoint — crawl main URL, return policies + company"
```

---

## Phase B — Backend ingest-stream (SSE) + promotion

### Task B1: `origin_user_id` on CompanyDocument

**Files:**
- Modify: `backend/src/plaindr/models/company.py`
- Modify: `backend/src/plaindr/clients/policy_store.py` (serialize in `upsert_companies`; parse in `_load_companies`)
- Test: `backend/tests/test_models/test_company.py`

- [ ] **Step 1: Write the failing test (append to test_company.py)**

```python
def test_company_carries_origin_user_id():
    from plaindr.models.company import CompanyDocument
    c = CompanyDocument(name="NewCo", origin_user_id="user-1")
    assert c.origin_user_id == "user-1"

def test_company_origin_defaults_none():
    from plaindr.models.company import CompanyDocument
    c = CompanyDocument(name="NewCo")
    assert c.origin_user_id is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_models/test_company.py -k origin -v`
Expected: FAIL — unexpected/missing field.

- [ ] **Step 3: Add the field + persistence**

In `company.py`, add to `CompanyDocument`:

```python
    # Set when a company is added via a user's Library submission, so
    # promoted-to-canonical companies can be audited or rolled back
    # later. None for the seeded corpus.
    origin_user_id: str | None = None
```

In `policy_store.py` `upsert_companies`, add to the `entries.append({...})` dict:

```python
                "origin_user_id": c.origin_user_id or "",
```

In `policy_store.py` `_load_companies`, when constructing each `CompanyDocument` from a yaml entry, pass:

```python
                origin_user_id=(entry.get("origin_user_id") or None),
```

> Read `_load_companies` (around line 367) to match the exact constructor call site before editing.

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_models/test_company.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/plaindr/models/company.py backend/src/plaindr/clients/policy_store.py backend/tests/test_models/test_company.py
git commit -m "feat(library): stamp origin_user_id on companies for audit/rollback"
```

---

### Task B2: Promotion helper — scrape one policy into the canonical corpus

**Files:**
- Modify: `backend/src/plaindr/api/routers/user_policies.py`
- Test: `backend/tests/test_api/test_user_policies_ingest.py`

This helper takes a `CompanyDocument` (already ensured) + one selected policy URL/type, scrapes it, and writes it to the corpus. Returns a result string: `promoted | unchanged | updated | failed`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_api/test_user_policies_ingest.py
"""Tests for promotion + the ingest-stream endpoint."""

from uuid import uuid4


def test_promote_new_policy(monkeypatch):
    from plaindr.api.routers import user_policies as mod
    from plaindr.models.company import CompanyDocument

    company = CompanyDocument(name="OpenAI", main_url="https://openai.com")

    # Fake a successful scrape.
    class _SR:
        markdown = "# Privacy Policy\n" + "x" * 600
        content_hash = "a" * 32
        title = "Privacy Policy"
        error = None

    monkeypatch.setattr(mod, "scrape_single_url", lambda url, s: _SR())

    calls = {}
    class _Store:
        def find_canonical_by_url(self, url): return None
        def register_policy(self, doc): calls["registered"] = doc
        def get_company_name(self, cid): return "OpenAI"
    class _Storage:
        def upload_policy(self, *a, **k): calls["uploaded"] = True

    # Patch _upsert_and_sync to a no-op that records the doc.
    import plaindr.pipelines.feature.orchestrator as orch
    monkeypatch.setattr(
        orch, "_upsert_and_sync",
        lambda doc, s, st, store, res: calls.setdefault("synced", doc),
    )

    result = mod._promote_one(
        company=company,
        url="https://openai.com/privacy",
        policy_type="privacy",
        settings=object(),
        storage=_Storage(),
        store=_Store(),
    )
    assert result == "promoted"
    assert "synced" in calls
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_api/test_user_policies_ingest.py::test_promote_new_policy -v`
Expected: FAIL — `_promote_one` undefined.

- [ ] **Step 3: Implement `_promote_one` in `user_policies.py`**

```python
def _promote_one(
    company,  # CompanyDocument
    url: str,
    policy_type: str,
    settings: Settings,
    storage: SupabaseStorageClient,
    store: PolicyStore,
) -> str:
    """Scrape one URL and write it into the canonical corpus.

    Returns: 'promoted' (new), 'updated' (changed existing),
    'unchanged' (existing identical), or 'failed'.
    """
    from plaindr.models.policy import PolicyDocument
    from plaindr.pipelines.feature.orchestrator import (
        PipelineResult,
        _upsert_and_sync,
    )

    sr = scrape_single_url(url, settings)
    if sr.error or sr.markdown is None or sr.content_hash is None:
        logger.warning("Promotion scrape failed for %s: %s", url, sr.error)
        return "failed"

    existing = store.find_canonical_by_url(url)
    if existing is not None and existing.id == sr.content_hash:
        return "unchanged"

    try:
        doc = PolicyDocument(
            id=sr.content_hash,
            author_id=company.id,
            title=sr.title or company.name,
            policy_type=policy_type,
            source_url=url,
            content=sr.markdown,
            version=(existing.version if existing else 1),
            previous_version_id=(existing.id if existing else None),
        )
        _upsert_and_sync(doc, settings, storage, store, PipelineResult())
    except Exception:
        logger.exception("Promotion upsert failed for %s", url)
        return "failed"

    return "updated" if existing is not None else "promoted"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_api/test_user_policies_ingest.py::test_promote_new_policy -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/plaindr/api/routers/user_policies.py backend/tests/test_api/test_user_policies_ingest.py
git commit -m "feat(library): _promote_one — scrape a URL into the canonical corpus"
```

---

### Task B3: Ensure-company helper

**Files:**
- Modify: `backend/src/plaindr/api/routers/user_policies.py`
- Test: `backend/tests/test_api/test_user_policies_ingest.py`

- [ ] **Step 1: Write the failing test (append)**

```python
def test_ensure_company_creates_when_new(monkeypatch):
    from plaindr.api.routers import user_policies as mod

    created = {}
    class _Store:
        def list_companies(self): return []
        def upsert_companies(self, comps): created["comps"] = comps; return len(comps)

    company = mod._ensure_company(
        store=_Store(),
        matched=False, name="NewCo", slug="newco", category="AI",
        main_url="https://newco.ai", origin_user_id="user-1",
    )
    assert created["comps"][0].name == "NewCo"
    assert created["comps"][0].origin_user_id == "user-1"
    assert company.id == created["comps"][0].id


def test_ensure_company_reuses_matched(monkeypatch):
    from plaindr.api.routers import user_policies as mod
    from plaindr.models.company import CompanyDocument

    existing = CompanyDocument(name="OpenAI", main_url="https://openai.com")
    class _Store:
        def list_companies(self): return [existing]
        def upsert_companies(self, comps): raise AssertionError("should not create")

    company = mod._ensure_company(
        store=_Store(), matched=True, name="OpenAI", slug="openai",
        category="AI Chat", main_url="https://openai.com",
        origin_user_id="user-1",
    )
    assert company.id == existing.id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_api/test_user_policies_ingest.py -k ensure_company -v`
Expected: FAIL — `_ensure_company` undefined.

- [ ] **Step 3: Implement `_ensure_company`**

```python
def _ensure_company(
    store: PolicyStore,
    matched: bool,
    name: str,
    slug: str,
    category: str,
    main_url: str,
    origin_user_id: str,
):  # -> CompanyDocument
    """Return the matching company, or create + persist a new one."""
    from urllib.parse import urlparse

    from plaindr.models.company import CompanyDocument
    from plaindr.pipelines.feature.company_discovery import _registrable_domain

    base = _registrable_domain(urlparse(main_url).netloc)
    for c in store.list_companies():
        cu = getattr(c, "main_url", None)
        if cu and _registrable_domain(urlparse(str(cu)).netloc) == base:
            return c

    company = CompanyDocument(
        name=name, category=category, main_url=main_url,
        origin_user_id=origin_user_id,
    )
    store.upsert_companies([company])
    return company
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_api/test_user_policies_ingest.py -k ensure_company -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/plaindr/api/routers/user_policies.py backend/tests/test_api/test_user_policies_ingest.py
git commit -m "feat(library): _ensure_company — create canonical company on first submit"
```

---

### Task B4: `POST /api/user-policies/ingest-stream` (SSE)

**Files:**
- Modify: `backend/src/plaindr/api/routers/user_policies.py`
- Test: `backend/tests/test_api/test_user_policies_ingest.py`

- [ ] **Step 1: Write the failing test (append)**

```python
def test_ingest_stream_emits_frames(ingest_client):
    # ingest_client: TestClient with feature flag on, _require_user → "u1",
    # _promote_one monkeypatched to return "promoted", _ensure_company → a
    # fake company, table.upsert_user_policy → no-op.
    resp = ingest_client.post(
        "/api/user-policies/ingest-stream",
        json={
            "company": {"matched": False, "name": "OpenAI",
                        "slug": "openai", "category": "AI Chat",
                        "main_url": "https://openai.com"},
            "organization_id": None,
            "policies": [
                {"url": "https://openai.com/privacy",
                 "policy_type": "privacy", "title": "Privacy Policy"}
            ],
        },
        headers={"Authorization": "Bearer test"},
    )
    assert resp.status_code == 200
    text = resp.text
    assert '"type":"start"' in text
    assert '"type":"policy_begin"' in text
    assert '"type":"policy_done"' in text
    assert '"type":"done"' in text


def test_ingest_stream_rejects_off_domain(ingest_client):
    resp = ingest_client.post(
        "/api/user-policies/ingest-stream",
        json={
            "company": {"matched": False, "name": "OpenAI",
                        "slug": "openai", "category": "AI Chat",
                        "main_url": "https://openai.com"},
            "organization_id": None,
            "policies": [
                {"url": "https://evil.com/privacy",
                 "policy_type": "privacy", "title": "x"}
            ],
        },
        headers={"Authorization": "Bearer test"},
    )
    assert resp.status_code == 400
```

> Build `ingest_client` in this file modeled on `discover_client`. The SSE body is fully buffered by `TestClient`, so asserting on `resp.text` works.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_api/test_user_policies_ingest.py -k ingest_stream -v`
Expected: FAIL — 404.

- [ ] **Step 3: Implement the endpoint**

Add models + endpoint. Use the same `_registrable_domain` for the guard, cap selection at 10, and stream JSON SSE frames (mirroring `query.py`'s StreamingResponse with `media_type="text/event-stream"`).

```python
import json

from fastapi.responses import StreamingResponse

_MAX_SELECT = 10


class IngestCompany(BaseModel):
    matched: bool
    name: str
    slug: str
    category: str
    main_url: str


class IngestPolicyItem(BaseModel):
    url: str
    policy_type: str
    title: str


class IngestRequest(BaseModel):
    company: IngestCompany
    organization_id: str | None = None
    policies: list[IngestPolicyItem] = Field(min_length=1, max_length=_MAX_SELECT)


@router.post(
    "/ingest-stream",
    dependencies=[Depends(_require_feature_enabled)],
)
def ingest_stream(
    body: IngestRequest,
    user_id: str = Depends(_require_user),
    settings: Settings = Depends(get_settings),
    table: SupabaseTableClient = Depends(_get_table_client),
    storage: SupabaseStorageClient = Depends(get_storage_client),
    store: PolicyStore = Depends(get_policy_store),
) -> StreamingResponse:
    """Scrape selected policies, promote to canonical, stream progress."""
    from urllib.parse import urlparse

    from plaindr.pipelines.feature.company_discovery import _registrable_domain

    # Rate-limit + org scope (same as submit).
    _hourly_limiter.check(f"user:{user_id}")
    organization_id = None
    if body.organization_id:
        if not table.is_org_member(user_id, body.organization_id):
            raise HTTPException(403, "Not a member of this organization")
        organization_id = body.organization_id

    # Same-domain guard — reject before streaming begins.
    base = _registrable_domain(urlparse(body.company.main_url).netloc)
    for p in body.policies:
        if _registrable_domain(urlparse(p.url).netloc) != base:
            raise HTTPException(
                400, f"Policy URL {p.url} is not on {base}"
            )

    def _event(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    def _generate():
        company = _ensure_company(
            store, body.company.matched, body.company.name,
            body.company.slug, body.company.category,
            body.company.main_url, origin_user_id=user_id,
        )
        total = len(body.policies)
        added = 0
        failed = 0
        yield _event({"type": "start", "total": total})
        for i, p in enumerate(body.policies):
            yield _event({
                "type": "policy_begin", "index": i,
                "title": p.title, "stage": "fetching",
            })
            result = _promote_one(
                company, p.url, p.policy_type, settings, storage, store,
            )
            if result == "failed":
                failed += 1
            else:
                added += 1
                # Link the user's Library row to the canonical policy.
                try:
                    table.upsert_user_policy(
                        user_id=user_id if organization_id is None else None,
                        organization_id=organization_id,
                        url=p.url,
                        title=p.title,
                        content_hash="",  # canonical is source of truth
                        storage_path="",
                        is_canonical_mirror=True,
                        last_status=result,
                        last_scraped_at=datetime.now(UTC),
                    )
                except Exception:
                    logger.exception("Library link upsert failed for %s", p.url)
            yield _event({
                "type": "policy_done", "index": i, "result": result,
            })
        yield _event({"type": "done", "added": added, "failed": failed})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

> The cinematic `policy_stage` frames (`refining`/`indexing`/`tracking`) are optional richness — `_promote_one` is a single blocking call so we can't emit true sub-stages without refactoring it to yield. For v1 the frontend animates between stages on a timer between `policy_begin` and `policy_done`; the spec's stage labels are driven client-side. Do NOT claim real sub-stage events exist.

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_api/test_user_policies_ingest.py -v`
Expected: PASS (all).

- [ ] **Step 5: Run the full backend suite + commit**

```bash
cd backend && .venv/bin/python -m pytest tests/ --ignore=tests/test_clients -q
git add backend/src/plaindr/api/routers/user_policies.py backend/tests/test_api/test_user_policies_ingest.py
git commit -m "feat(library): /ingest-stream SSE — promote selected policies to corpus"
```

---

## Phase C — Server tRPC: discover proxy

### Task C1: `userPolicies.discover` procedure

**Files:**
- Modify: `server/routers.ts` (inside the `userPolicies: router({ ... })` block, alongside `submit`)

- [ ] **Step 1: Add the procedure**

```typescript
    // Discover policy URLs from a company's main URL. Fast (map only),
    // so a 30s timeout is generous. Mirrors `submit`'s JWT forwarding.
    discover: protectedProcedure
      .input(z.object({
        url: z.string().url(),
        organization_id: z.string().uuid().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { signal, cancel } = timeoutSignal(30_000);
        try {
          return await callBackend<{
            company: {
              matched: boolean; name: string; slug: string;
              category: string; main_url: string;
            };
            policies: Array<{
              url: string; policy_type: string; title: string;
            }>;
          }>(
            "/api/user-policies/discover",
            "POST",
            { url: input.url, organization_id: input.organization_id },
            ctx.user.accessToken,
            signal,
          );
        } finally {
          cancel();
        }
      }),
```

- [ ] **Step 2: Type-check**

Run: `pnpm check`
Expected: no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add server/routers.ts
git commit -m "feat(library): userPolicies.discover tRPC proxy to FastAPI"
```

---

## Phase D — Frontend

### Task D1: SSE ingest client in `api.ts`

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Add types + the streaming function**

Add near the existing `QuerySource` types:

```typescript
export type IngestPolicyInput = {
  url: string;
  policy_type: string;
  title: string;
};

export type IngestCompanyInput = {
  matched: boolean;
  name: string;
  slug: string;
  category: string;
  main_url: string;
};

export type IngestEvent =
  | { type: "start"; total: number }
  | { type: "policy_begin"; index: number; title: string; stage: string }
  | { type: "policy_done"; index: number; result: string }
  | { type: "done"; added: number; failed: number };
```

Add the function (reuse the SSE frame-parsing approach from `streamQuery`; attach the Supabase token since this hits FastAPI directly):

```typescript
  async ingestPoliciesStream(
    body: {
      company: IngestCompanyInput;
      organization_id: string | null;
      policies: IngestPolicyInput[];
    },
    handlers: {
      onEvent: (e: IngestEvent) => void;
      onError?: (err: unknown) => void;
      signal?: AbortSignal;
      accessToken: string;
    },
  ): Promise<void> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/user-policies/ingest-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${handlers.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: handlers.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Ingest failed: ${res.status} ${res.statusText}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\n\n+/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split(/\n/)) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload) continue;
            try {
              handlers.onEvent(JSON.parse(payload) as IngestEvent);
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      }
    } catch (err) {
      handlers.onError?.(err);
    }
  },
```

- [ ] **Step 2: Type-check**

Run: `pnpm check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat(library): SSE client for /ingest-stream"
```

---

### Task D2: `IngestProgress` cinematic component

**Files:**
- Create: `client/src/components/dashboard/IngestProgress.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { IngestEvent, IngestPolicyInput } from "@/lib/api";

type Status = "pending" | "active" | "done" | "failed";

const STAGE_CAPTIONS: Record<string, string> = {
  fetching: "Reading the page…",
  refining: "Cleaning up the legalese…",
  indexing: "Filing it into the corpus…",
  tracking: "Setting up change tracking…",
};

export function IngestProgress({
  policies,
  events,
}: {
  policies: IngestPolicyInput[];
  events: IngestEvent[];
}) {
  const reduce = useReducedMotion();
  const [statuses, setStatuses] = useState<Status[]>(
    () => policies.map(() => "pending"),
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [caption, setCaption] = useState("Starting…");

  // Reduce the event log into per-policy status + a live caption.
  useEffect(() => {
    const next: Status[] = policies.map(() => "pending");
    let active: number | null = null;
    for (const e of events) {
      if (e.type === "policy_begin") {
        next[e.index] = "active";
        active = e.index;
      } else if (e.type === "policy_done") {
        next[e.index] = e.result === "failed" ? "failed" : "done";
        if (active === e.index) active = null;
      }
    }
    setStatuses(next);
    setActiveIndex(active);
  }, [events, policies]);

  // Cinematic stage caption: cycle stage labels while a policy is active.
  useEffect(() => {
    if (activeIndex === null) return;
    const order = ["fetching", "refining", "indexing", "tracking"];
    let i = 0;
    setCaption(STAGE_CAPTIONS[order[0]]);
    const id = setInterval(() => {
      i = (i + 1) % order.length;
      setCaption(STAGE_CAPTIONS[order[i]]);
    }, 1800);
    return () => clearInterval(id);
  }, [activeIndex]);

  const orbHue = activeIndex !== null ? 265 : 150; // violet working, green idle

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      <motion.div
        aria-hidden
        className="h-20 w-20 rounded-full"
        style={{
          background: `radial-gradient(circle at 35% 30%, hsl(${orbHue} 90% 70%), hsl(${orbHue} 80% 45%))`,
          boxShadow: `0 0 48px hsl(${orbHue} 80% 60% / 0.5)`,
        }}
        animate={reduce ? {} : { scale: [1, 1.08, 1] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <AnimatePresence mode="wait">
        <motion.p
          key={caption}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="text-sm text-foreground/80"
        >
          {caption}
        </motion.p>
      </AnimatePresence>
      <div className="flex flex-wrap justify-center gap-2">
        {policies.map((p, i) => (
          <motion.div
            key={p.url}
            layout
            className={
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] " +
              (statuses[i] === "active"
                ? "border-primary bg-primary/10 text-foreground"
                : statuses[i] === "done"
                  ? "border-emerald-500/40 text-foreground"
                  : statuses[i] === "failed"
                    ? "border-muted text-muted-foreground opacity-60"
                    : "border-border text-muted-foreground")
            }
          >
            {statuses[i] === "done" && (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            )}
            {statuses[i] === "failed" && (
              <AlertCircle className="h-3.5 w-3.5" />
            )}
            <span className="truncate max-w-[160px]">{p.title}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/dashboard/IngestProgress.tsx
git commit -m "feat(library): cinematic IngestProgress scene"
```

---

### Task D3: Rebuild `SubmitPolicyDialog` as a 4-state machine

**Files:**
- Modify: `client/src/components/dashboard/SubmitPolicyDialog.tsx`

- [ ] **Step 1: Replace the dialog body with the state machine**

States: `input` (paste main URL) → `review` (confirm company + pick policies) → `ingesting` (`IngestProgress`) → `done` (summary). Wire:
- `input` submit → `trpc.userPolicies.discover.useMutation`; on success store `{company, policies}` and go to `review`.
- `review` → editable company name + category inputs (pre-filled from `company`), a checkbox list of `policies` (all checked by default), "Add selected" button.
- "Add selected" → fetch the Supabase token via `supabase.auth.getSession()`, call `api.ingestPoliciesStream`, push each `IngestEvent` into a `events` state array, render `<IngestProgress policies={selected} events={events} />`. On the `done` event, transition to `done`.
- `done` → summary line ("Added N policies to {company.name} — now tracked for changes"; if any failed, "Added N, couldn't read M" + failed titles). CTAs "View in Library" / "Add another".

Full replacement code:

```tsx
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { useActiveOrgId } from "@/_core/hooks/useActiveOrg";
import { supabase } from "@/lib/supabase"; // verify exact import path
import {
  api,
  type IngestCompanyInput,
  type IngestEvent,
  type IngestPolicyInput,
} from "@/lib/api";
import { IngestProgress } from "./IngestProgress";

type Phase = "input" | "review" | "ingesting" | "done";

export function SubmitPolicyDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const utils = trpc.useUtils();
  const organizationId = useActiveOrgId();

  const [phase, setPhase] = useState<Phase>("input");
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState<IngestCompanyInput | null>(null);
  const [policies, setPolicies] = useState<IngestPolicyInput[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [events, setEvents] = useState<IngestEvent[]>([]);

  const discover = trpc.userPolicies.discover.useMutation({
    onSuccess: data => {
      setCompany(data.company as IngestCompanyInput);
      setPolicies(data.policies);
      setChecked(Object.fromEntries(data.policies.map(p => [p.url, true])));
      setPhase("review");
    },
    onError: err => toast.error(err.message),
  });

  const selected = useMemo(
    () => policies.filter(p => checked[p.url]),
    [policies, checked],
  );

  function reset() {
    setPhase("input"); setUrl(""); setCompany(null);
    setPolicies([]); setChecked({}); setEvents([]);
    discover.reset();
  }

  function handleClose(next: boolean) {
    if (!next && phase === "ingesting") return; // block close mid-ingest
    if (!next) reset();
    onOpenChange(next);
  }

  async function startIngest() {
    if (!company || selected.length === 0) return;
    setEvents([]); setPhase("ingesting");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    await api.ingestPoliciesStream(
      { company, organization_id: organizationId, policies: selected },
      {
        accessToken: token,
        onEvent: e => {
          setEvents(prev => [...prev, e]);
          if (e.type === "done") {
            setPhase("done");
            utils.userPolicies.list.invalidate({
              organization_id: organizationId,
            });
            qc.invalidateQueries();
          }
        },
        onError: err =>
          toast.error(err instanceof Error ? err.message : "Ingest failed"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        {phase === "input" && (
          <form
            onSubmit={e => {
              e.preventDefault();
              const t = url.trim();
              if (t) discover.mutate({ url: t, organization_id: organizationId });
            }}
          >
            <DialogHeader>
              <DialogTitle>Add a company</DialogTitle>
              <DialogDescription>
                Paste a company's main URL. Plaindr finds its privacy,
                terms, and security pages — you pick which to add.
              </DialogDescription>
            </DialogHeader>
            <div className="py-3">
              <Label htmlFor="company-url">Company URL</Label>
              <Input
                id="company-url" type="url" autoFocus required
                placeholder="https://chatgpt.com" value={url}
                onChange={e => setUrl(e.target.value)} className="mt-1.5"
              />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                We'll scan the site for policy pages — takes a few seconds.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost"
                onClick={() => handleClose(false)}>Cancel</Button>
              <Button type="submit" disabled={!url.trim() || discover.isPending}>
                {discover.isPending ? "Scanning…" : "Find policies"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {phase === "review" && company && (
          <>
            <DialogHeader>
              <DialogTitle>Confirm & pick policies</DialogTitle>
              <DialogDescription>
                Found {policies.length} policy page
                {policies.length === 1 ? "" : "s"} on {company.main_url}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              <div>
                <Label htmlFor="co-name">Company</Label>
                <Input id="co-name" value={company.name} className="mt-1.5"
                  onChange={e => setCompany({ ...company, name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="co-cat">Category</Label>
                <Input id="co-cat" value={company.category} className="mt-1.5"
                  onChange={e => setCompany({ ...company, category: e.target.value })} />
              </div>
            </div>
            <div className="max-h-56 overflow-auto space-y-1.5 py-1">
              {policies.map(p => (
                <label key={p.url}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                  <Checkbox checked={!!checked[p.url]}
                    onCheckedChange={v =>
                      setChecked(c => ({ ...c, [p.url]: !!v }))} />
                  <span className="text-[12px] truncate flex-1">{p.title}</span>
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">
                    {p.policy_type}
                  </span>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPhase("input")}>Back</Button>
              <Button onClick={startIngest} disabled={selected.length === 0}>
                Add {selected.length} {selected.length === 1 ? "policy" : "policies"}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === "ingesting" && (
          <>
            <DialogHeader>
              <DialogTitle>Adding policies…</DialogTitle>
              <DialogDescription>
                Hang tight — we're reading and filing each page.
              </DialogDescription>
            </DialogHeader>
            <IngestProgress policies={selected} events={events} />
          </>
        )}

        {phase === "done" && company && (
          <DoneView company={company} events={events} selected={selected}
            onAddAnother={reset} onClose={() => handleClose(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DoneView({
  company, events, selected, onAddAnother, onClose,
}: {
  company: IngestCompanyInput;
  events: IngestEvent[];
  selected: IngestPolicyInput[];
  onAddAnother: () => void;
  onClose: () => void;
}) {
  const doneEvent = events.find(e => e.type === "done") as
    | Extract<IngestEvent, { type: "done" }> | undefined;
  const added = doneEvent?.added ?? 0;
  const failed = doneEvent?.failed ?? 0;
  const failedTitles = selected
    .filter((_, i) =>
      events.some(e => e.type === "policy_done" && e.index === i && e.result === "failed"))
    .map(p => p.title);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          {failed === 0
            ? `Added ${added} ${added === 1 ? "policy" : "policies"} to ${company.name}`
            : `Added ${added}, couldn't read ${failed}`}
        </DialogTitle>
        <DialogDescription>
          Now tracked for changes — you'll see updates in the diff feed.
          {failedTitles.length > 0 && (
            <span className="block mt-1 text-[12px]">
              Skipped: {failedTitles.join(", ")}
            </span>
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" onClick={onAddAnother}>Add another</Button>
        <Button onClick={onClose}>
          Done <ArrowRight className="h-4 w-4 ml-1.5" />
        </Button>
      </DialogFooter>
    </>
  );
}
```

> Verify these import paths against the repo before finalizing: `@/lib/supabase` (the supabase browser client — grep for where `supabase.auth.getSession` is imported, likely `client/src/lib/supabase.ts` or similar), the `Checkbox` component path (`@/components/ui/checkbox`), and that `api` is exported from `@/lib/api`. Fix paths to match.

- [ ] **Step 2: Type-check + build**

Run: `pnpm check`
Expected: no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/dashboard/SubmitPolicyDialog.tsx
git commit -m "feat(library): main-URL submit flow — discover, pick, cinematic ingest"
```

---

### Task D4: Manual verification

- [ ] **Step 1: Run the app and exercise the flow**

Run the backend (with `USER_POLICIES_ENABLED=true` and a valid `ANTHROPIC_API_KEY`) and the frontend. In the Library, click Add, paste a known company main URL, confirm the company + policy list appears, pick a subset, watch the cinematic progress, and verify the policies appear in the Library and the company appears in the sidebar list.

Expected: discovered policies stream in, end state shows the summary, sidebar shows the (possibly new) company, clicking it shows its policies.

- [ ] **Step 2: Commit any path fixes found during verification**

```bash
git add -A && git commit -m "fix(library): correct import paths / wiring found in manual QA"
```

---

## Self-Review Notes (coverage check)

- Spec "discover endpoint" → Tasks A1–A4. ✅
- Spec "ingest-stream SSE + promotion outcomes" → Tasks B2, B4. ✅
- Spec "new company identity (auto-infer, confirm in review)" → A2/A3 (infer) + D3 (confirm). ✅
- Spec "promote to canonical corpus, weekly tracking free" → B2 reuses `_upsert_and_sync` (writes to policies bucket + registers; weekly cron picks up by `source_url`). ✅
- Spec guardrails: same-domain (A1 + B4), content validation (inherited via `scrape_single_url`/orchestrator validators), selection cap (B4 `_MAX_SELECT`), rate limits (A4 + B4 reuse `_hourly_limiter`), dedup (B2 `find_canonical_by_url`, B3 domain match), `origin_user_id` (B1 + B3). ✅
- Spec "cinematic frontend, reduced-motion, failure framing" → D2 + D3. ✅
- Out of scope (review queue, job queue) → not implemented; SSE chosen. ✅

**Known follow-ups (not blockers):** true per-policy sub-stage events would require refactoring `_promote_one` into a generator; v1 animates stages client-side (documented in B4). The daily DB rate cap (`user_policy_count_recent`) is enforced on `submit` today — consider adding it to `discover`/`ingest-stream` if abuse appears (hourly cap already applies).
