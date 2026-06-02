"""Tests for crawl-from-main-URL discovery + company resolution."""

import pytest

from plaindr.clients.protocol import UrlDiscoveryProtocol
from plaindr.pipelines.feature.company_discovery import (
    DiscoveredPolicy,
    discover_policies_for_domain,
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
    def test_returns_typed_policies_same_domain_only(self):
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

    def test_infers_policy_type(self):
        fc = _FakeFirecrawl(["https://x.com/legal/privacy"])
        out = discover_policies_for_domain(fc, "https://x.com")
        assert out[0].policy_type == "privacy"

    def test_dedups_normalized_urls(self):
        fc = _FakeFirecrawl([
            "https://x.com/privacy",
            "https://x.com/privacy/",  # trailing slash -> same
        ])
        out = discover_policies_for_domain(fc, "https://x.com")
        assert len(out) == 1

    def test_subdomain_of_same_registrable_domain_allowed(self):
        # policy.openai.com is the same registrable domain as openai.com
        fc = _FakeFirecrawl(["https://policy.openai.com/privacy"])
        out = discover_policies_for_domain(fc, "https://openai.com")
        assert len(out) == 1
        assert out[0].url == "https://policy.openai.com/privacy"

    def test_empty_url_list_returns_empty(self):
        fc = _FakeFirecrawl([])
        out = discover_policies_for_domain(fc, "https://openai.com")
        assert out == []

    def test_general_policy_type_fallback(self):
        # URL with no privacy/tos/security signal -> "general"
        fc = _FakeFirecrawl(["https://x.com/legal/guidelines"])
        out = discover_policies_for_domain(fc, "https://x.com")
        assert out[0].policy_type == "general"

    def test_result_items_are_discovered_policy_instances(self):
        fc = _FakeFirecrawl(["https://x.com/legal/privacy"])
        out = discover_policies_for_domain(fc, "https://x.com")
        assert all(isinstance(p, DiscoveredPolicy) for p in out)

    def test_title_populated_for_known_types(self):
        fc = _FakeFirecrawl([
            "https://x.com/privacy",
            "https://x.com/terms",
        ])
        out = discover_policies_for_domain(fc, "https://x.com")
        by_type = {p.policy_type: p.title for p in out}
        assert by_type["privacy"] == "Privacy Policy"
        assert by_type["tos"] == "Terms of Service"

    def test_invalid_main_url_raises_value_error(self):
        fc = _FakeFirecrawl([])
        with pytest.raises(ValueError, match="absolute URL"):
            discover_policies_for_domain(fc, "not-a-url")
