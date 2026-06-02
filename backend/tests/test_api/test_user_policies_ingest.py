"""Tests for _promote_one — scrape a URL into the canonical corpus."""

from __future__ import annotations

from typing import Any, NoReturn

import pytest

import plaindr.pipelines.feature.orchestrator as orch
from plaindr.api.routers import user_policies as up
from plaindr.models.company import CompanyDocument


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------

class _SR:
    """Minimal fake of SingleScrapeResult."""

    def __init__(
        self,
        markdown: str | None,
        content_hash: str | None,
        title: str = "Privacy Policy",
        error: str | None = None,
    ) -> None:
        self.markdown = markdown
        self.content_hash = content_hash
        self.title = title
        self.error = error


class _Existing:
    """Fake existing PolicyDocument returned by store.find_canonical_by_url."""

    def __init__(self, doc_id: str, version: int = 1) -> None:
        self.id = doc_id
        self.version = version


class _Store:
    """Fake PolicyStore — only find_canonical_by_url is needed."""

    def __init__(self, existing: Any = None) -> None:
        self._existing = existing

    def find_canonical_by_url(self, url: str) -> Any:
        return self._existing


class _Opaque:
    """Raises AttributeError with context if accessed — better than object()."""

    def __init__(self, label: str) -> None:
        self._label = label

    def __getattr__(self, name: str) -> NoReturn:
        raise AttributeError(
            f"<{self._label}> unexpectedly accessed attribute '{name}' "
            "— the helper should not touch settings/storage in these paths"
        )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

# NOTE: _promote_one imports `_upsert_and_sync` with a late import inside
# the function body:  `from plaindr.pipelines.feature.orchestrator import ...`
# Patching the *source* module attribute (orch._upsert_and_sync) is therefore
# the correct target — the `from ... import` resolves at call time, so the
# patched value is picked up.


def test_promote_new_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    """New URL (no existing canonical) → scrape, upsert, return 'promoted'."""
    company = CompanyDocument(name="OpenAI", main_url="https://openai.com")

    monkeypatch.setattr(
        up,
        "scrape_single_url",
        lambda url, s: _SR("# Privacy Policy\n" + "x" * 600, "a" * 32),
    )

    synced: dict[str, Any] = {}
    monkeypatch.setattr(
        orch,
        "_upsert_and_sync",
        lambda doc, s, st, store, res: synced.setdefault("doc", doc),
    )

    result = up._promote_one(
        company=company,
        url="https://openai.com/privacy",
        policy_type="privacy",
        settings=_Opaque("settings"),
        storage=_Opaque("storage"),
        store=_Store(existing=None),
    )

    assert result == "promoted"
    assert "doc" in synced, "_upsert_and_sync was never called"
    assert synced["doc"].author_id == company.id
    assert synced["doc"].policy_type == "privacy"
    assert synced["doc"].id == "a" * 32


def test_promote_unchanged_when_hash_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    """Existing canonical with same content hash → skip upsert, return 'unchanged'."""
    company = CompanyDocument(name="OpenAI", main_url="https://openai.com")
    existing = _Existing(doc_id="a" * 32, version=3)

    monkeypatch.setattr(
        up,
        "scrape_single_url",
        lambda url, s: _SR("# P\n" + "x" * 600, "a" * 32),
    )

    upsert_called: list[bool] = []
    monkeypatch.setattr(
        orch,
        "_upsert_and_sync",
        lambda *a, **kw: upsert_called.append(True),
    )

    result = up._promote_one(
        company=company,
        url="https://openai.com/privacy",
        policy_type="privacy",
        settings=_Opaque("settings"),
        storage=_Opaque("storage"),
        store=_Store(existing=existing),
    )

    assert result == "unchanged"
    assert not upsert_called, "_upsert_and_sync should not be called for unchanged content"


def test_promote_failed_on_scrape_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scrape error (error set, markdown None) → return 'failed', no upsert."""
    company = CompanyDocument(name="OpenAI", main_url="https://openai.com")

    monkeypatch.setattr(
        up,
        "scrape_single_url",
        lambda url, s: _SR(None, None, error="boom"),
    )

    upsert_called: list[bool] = []
    monkeypatch.setattr(
        orch,
        "_upsert_and_sync",
        lambda *a, **kw: upsert_called.append(True),
    )

    result = up._promote_one(
        company=company,
        url="https://openai.com/privacy",
        policy_type="privacy",
        settings=_Opaque("settings"),
        storage=_Opaque("storage"),
        store=_Store(existing=None),
    )

    assert result == "failed"
    assert not upsert_called


def test_promote_failed_on_empty_markdown(monkeypatch: pytest.MonkeyPatch) -> None:
    """Markdown present but no content_hash → 'failed' (hash guard fires)."""
    company = CompanyDocument(name="OpenAI", main_url="https://openai.com")

    monkeypatch.setattr(
        up,
        "scrape_single_url",
        lambda url, s: _SR("", None, error=None),
    )

    upsert_called: list[bool] = []
    monkeypatch.setattr(
        orch,
        "_upsert_and_sync",
        lambda *a, **kw: upsert_called.append(True),
    )

    result = up._promote_one(
        company=company,
        url="https://openai.com/privacy",
        policy_type="privacy",
        settings=_Opaque("settings"),
        storage=_Opaque("storage"),
        store=_Store(existing=None),
    )

    assert result == "failed"
    assert not upsert_called


def test_promote_updated_when_hash_differs(monkeypatch: pytest.MonkeyPatch) -> None:
    """Existing canonical with different hash → upsert, return 'updated'."""
    company = CompanyDocument(name="OpenAI", main_url="https://openai.com")
    existing = _Existing(doc_id="b" * 32, version=2)

    monkeypatch.setattr(
        up,
        "scrape_single_url",
        lambda url, s: _SR("# New Privacy Policy\n" + "x" * 600, "a" * 32),
    )

    synced: dict[str, Any] = {}
    monkeypatch.setattr(
        orch,
        "_upsert_and_sync",
        lambda doc, s, st, store, res: synced.setdefault("doc", doc),
    )

    result = up._promote_one(
        company=company,
        url="https://openai.com/privacy",
        policy_type="privacy",
        settings=_Opaque("settings"),
        storage=_Opaque("storage"),
        store=_Store(existing=existing),
    )

    assert result == "updated"
    assert "doc" in synced, "_upsert_and_sync was never called"
    assert synced["doc"].previous_version_id == "b" * 32


def test_promote_failed_when_upsert_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Storage/LLM failure inside _upsert_and_sync → return 'failed'."""
    company = CompanyDocument(name="OpenAI", main_url="https://openai.com")

    monkeypatch.setattr(
        up,
        "scrape_single_url",
        lambda url, s: _SR("# Privacy Policy\n" + "x" * 600, "a" * 32),
    )

    def _raise_storage_error(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("storage down")

    monkeypatch.setattr(orch, "_upsert_and_sync", _raise_storage_error)

    result = up._promote_one(
        company=company,
        url="https://openai.com/privacy",
        policy_type="privacy",
        settings=_Opaque("settings"),
        storage=_Opaque("storage"),
        store=_Store(existing=None),
    )

    assert result == "failed"


def test_ensure_company_creates_when_new():
    created = {}

    class _NewStore:
        def list_companies(self):
            return []
        def upsert_companies(self, comps):
            created["comps"] = comps
            return len(comps)

    company = up._ensure_company(
        store=_NewStore(),
        matched=False, name="NewCo", slug="newco", category="AI",
        main_url="https://newco.ai", origin_user_id="user-1",
    )
    assert created["comps"][0].name == "NewCo"
    assert created["comps"][0].origin_user_id == "user-1"
    assert company.id == created["comps"][0].id


def test_ensure_company_reuses_matched():
    existing = CompanyDocument(name="OpenAI", main_url="https://openai.com")

    class _MatchStore:
        def list_companies(self):
            return [existing]
        def upsert_companies(self, comps):
            raise AssertionError("should not create when a match exists")

    company = up._ensure_company(
        store=_MatchStore(),
        matched=True, name="OpenAI", slug="openai",
        category="AI Chat", main_url="https://openai.com",
        origin_user_id="user-1",
    )
    assert company.id == existing.id
