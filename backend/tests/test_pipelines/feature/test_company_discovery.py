"""Tests for crawl-from-main-URL discovery + company resolution."""

from uuid import UUID, uuid4

import pytest

import plaindr.pipelines.feature.company_discovery as company_discovery_mod
from plaindr.clients.protocol import UrlDiscoveryProtocol
from plaindr.pipelines.feature.company_discovery import (
    DiscoveredPolicy,
    discover_policies_for_domain,
    infer_company_identity,
    resolve_company,
)


class _FakeFirecrawl:
    """Fake that structurally satisfies UrlDiscoveryProtocol."""

    def __init__(self, urls: list[str]) -> None:
        self._urls = urls

    def map_policy_urls(self, domain_url: str) -> list[str]:
        return self._urls


# Verify the fake actually satisfies the protocol at import time.
assert isinstance(_FakeFirecrawl([]), UrlDiscoveryProtocol)


class TestDiscoverPoliciesForDomain:
    def test_returns_typed_policies_same_domain_only(self) -> None:
        fc = _FakeFirecrawl([
            "https://openai.com/policies/privacy-policy",
            "https://openai.com/policies/terms-of-use",
            "https://evil.com/policies/privacy",  # off-domain -> dropped
        ])
        out = discover_policies_for_domain(fc, "https://openai.com")
        urls = [p.url for p in out]
        assert "https://openai.com/policies/privacy-policy" in urls
        assert "https://openai.com/policies/terms-of-use" in urls
        assert all("evil.com" not in u for u in urls)

    def test_infers_policy_type(self) -> None:
        fc = _FakeFirecrawl(["https://x.com/legal/privacy"])
        out = discover_policies_for_domain(fc, "https://x.com")
        assert len(out) == 1
        assert out[0].policy_type == "privacy"

    def test_dedups_normalized_urls(self) -> None:
        fc = _FakeFirecrawl([
            "https://x.com/privacy",
            "https://x.com/privacy/",  # trailing slash -> same
        ])
        out = discover_policies_for_domain(fc, "https://x.com")
        assert len(out) == 1

    def test_subdomain_of_same_registrable_domain_allowed(self) -> None:
        # policy.openai.com is the same registrable domain as openai.com
        fc = _FakeFirecrawl(["https://policy.openai.com/privacy"])
        out = discover_policies_for_domain(fc, "https://openai.com")
        assert len(out) == 1
        assert out[0].url == "https://policy.openai.com/privacy"

    def test_empty_url_list_returns_empty(self) -> None:
        fc = _FakeFirecrawl([])
        out = discover_policies_for_domain(fc, "https://openai.com")
        assert out == []

    def test_general_policy_type_fallback(self) -> None:
        # URL with no privacy/tos/security signal -> "general"
        fc = _FakeFirecrawl(["https://x.com/legal/guidelines"])
        out = discover_policies_for_domain(fc, "https://x.com")
        assert len(out) == 1
        assert out[0].policy_type == "general"

    def test_result_items_are_discovered_policy_instances(self) -> None:
        fc = _FakeFirecrawl(["https://x.com/legal/privacy"])
        out = discover_policies_for_domain(fc, "https://x.com")
        assert all(isinstance(p, DiscoveredPolicy) for p in out)

    def test_title_populated_for_known_types(self) -> None:
        fc = _FakeFirecrawl([
            "https://x.com/privacy",
            "https://x.com/terms",
        ])
        out = discover_policies_for_domain(fc, "https://x.com")
        by_type = {p.policy_type: p.title for p in out}
        assert by_type["privacy"] == "Privacy Policy"
        assert by_type["tos"] == "Terms of Service"

    def test_invalid_main_url_raises_value_error(self) -> None:
        fc = _FakeFirecrawl([])
        with pytest.raises(ValueError, match="absolute URL"):
            discover_policies_for_domain(fc, "not-a-url")


# ---------------------------------------------------------------------------
# Helpers for TestResolveCompany
# ---------------------------------------------------------------------------


class _FakeCompany:
    def __init__(self, name: str, slug_domain: str) -> None:
        self.id: UUID = uuid4()
        self.name: str = name
        self.category: str = "AI Chat"
        self.main_url: str = f"https://{slug_domain}"


class _FakeStore:
    def __init__(self, companies: list[_FakeCompany]) -> None:
        self._companies = companies

    def list_companies(self) -> list[_FakeCompany]:
        return self._companies


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestResolveCompany:
    def test_matches_existing_by_domain(self) -> None:
        existing = _FakeCompany("OpenAI", "openai.com")
        store = _FakeStore([existing])
        out = resolve_company(
            store,
            main_url="https://openai.com",
            infer=lambda *a, **k: ("WRONG", "WRONG"),
        )
        assert out.matched is True
        assert out.name == "OpenAI"
        assert out.slug == "openai"
        # category must come from the matched entity, not from infer
        assert out.category == existing.category
        # main_url normalizes to the caller's origin, not the stored URL
        assert out.main_url == "https://openai.com"

    def test_infers_when_no_match(self) -> None:
        store = _FakeStore([])
        out = resolve_company(
            store,
            main_url="https://newco.ai",
            infer=lambda main_url, titles: ("NewCo", "AI Agents"),
        )
        assert out.matched is False
        assert out.name == "NewCo"
        assert out.category == "AI Agents"
        assert out.slug == "newco"

    def test_different_domain_does_not_match(self) -> None:
        """A company whose main_url is on a different registrable domain
        must NOT be returned as a match."""
        other = _FakeCompany("Anthropic", "anthropic.com")
        store = _FakeStore([other])
        out = resolve_company(
            store,
            main_url="https://openai.com",
            infer=lambda main_url, titles: ("OpenAI", "AI Chat"),
        )
        assert out.matched is False
        assert out.name == "OpenAI"


# ---------------------------------------------------------------------------
# TestInferCompanyIdentity
# ---------------------------------------------------------------------------


class TestInferCompanyIdentity:
    def test_falls_back_to_domain_on_error(self, monkeypatch) -> None:
        # Force the LLM call to raise; helper must degrade gracefully.
        # Contract: _domain_fallback_name strips "www.", takes the first
        # label before ".", and capitalises it — "cooltool.ai" -> "Cooltool".
        class _NoSettings:
            """Stub settings: never accessed because the error branch fires first."""

        def _boom(*a, **k) -> None:
            raise RuntimeError("no credits")

        monkeypatch.setattr(company_discovery_mod, "_call_anthropic_for_identity", _boom)
        name, category = infer_company_identity(
            "https://cooltool.ai", ["Privacy Policy"], settings=_NoSettings(),
        )
        assert name == "Cooltool"  # _domain_fallback_name("https://cooltool.ai")
        assert category == "Other"
