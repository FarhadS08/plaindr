"""Tests for URL discovery — pre-scrape enrichment that finds
policy URLs not present in the CSV via Firecrawl map()."""

from unittest.mock import MagicMock
from uuid import uuid4

from plaindr.pipelines.feature.csv_loader import ScrapingTask
from plaindr.pipelines.feature.url_discovery import (
    _infer_policy_type,
    _normalize_url,
    discover_missing_urls,
)


class TestInferPolicyType:
    def test_privacy_url(self):
        assert _infer_policy_type("https://example.com/privacy") == "privacy"

    def test_privacy_policy_url(self):
        assert _infer_policy_type("https://example.com/privacy-policy") == "privacy"

    def test_terms_url(self):
        assert _infer_policy_type("https://example.com/terms") == "tos"

    def test_tos_url(self):
        assert _infer_policy_type("https://example.com/tos") == "tos"

    def test_security_url(self):
        assert _infer_policy_type("https://example.com/security") == "security"

    def test_compliance_url(self):
        assert _infer_policy_type("https://example.com/compliance") == "security"

    def test_dpa_url(self):
        url = "https://example.com/data-processing-agreement"
        assert _infer_policy_type(url) == "privacy"

    def test_gdpr_url(self):
        assert _infer_policy_type("https://example.com/gdpr") == "privacy"

    def test_ccpa_url(self):
        assert _infer_policy_type("https://example.com/ccpa") == "privacy"

    def test_cookie_url(self):
        assert _infer_policy_type("https://example.com/cookie-policy") == "privacy"

    def test_acceptable_use_url(self):
        assert _infer_policy_type("https://example.com/acceptable-use") == "tos"

    def test_eula_url(self):
        assert _infer_policy_type("https://example.com/eula") == "tos"

    def test_unknown_url(self):
        assert _infer_policy_type("https://example.com/about") == "general"

    def test_general_fallback(self):
        assert _infer_policy_type("https://example.com/legal/misc") == "general"


class TestNormalizeUrl:
    def test_strips_trailing_slash(self):
        assert _normalize_url("https://example.com/privacy/") == "https://example.com/privacy"

    def test_lowercases(self):
        assert _normalize_url("https://Example.Com/Privacy") == "https://example.com/privacy"

    def test_no_change_needed(self):
        assert _normalize_url("https://example.com/privacy") == "https://example.com/privacy"


class TestDiscoverMissingUrls:
    def _make_task(self, url, company_name="TestCo", policy_type="privacy"):
        return ScrapingTask(
            company_id=uuid4(),
            company_name=company_name,
            category="ai",
            policy_url=url,
            policy_type=policy_type,
        )

    def test_discovers_new_urls(self):
        """map() returns URLs not in the CSV — they become new tasks."""
        task = self._make_task("https://example.com/privacy")
        mock_client = MagicMock()
        mock_client.map_policy_urls.return_value = [
            "https://example.com/privacy",  # Already in CSV
            "https://example.com/terms",     # NEW
            "https://example.com/cookie-policy",  # NEW
        ]

        new_tasks = discover_missing_urls(mock_client, [task])

        assert len(new_tasks) == 2
        urls = {t.policy_url for t in new_tasks}
        assert "https://example.com/terms" in urls
        assert "https://example.com/cookie-policy" in urls

    def test_infers_policy_types(self):
        """Discovered URLs get correct policy_type inference."""
        task = self._make_task("https://example.com/privacy")
        mock_client = MagicMock()
        mock_client.map_policy_urls.return_value = [
            "https://example.com/terms-of-service",
            "https://example.com/security-policy",
        ]

        new_tasks = discover_missing_urls(mock_client, [task])

        types = {t.policy_url: t.policy_type for t in new_tasks}
        assert types["https://example.com/terms-of-service"] == "tos"
        assert types["https://example.com/security-policy"] == "security"

    def test_retains_company_metadata(self):
        """Discovered tasks inherit company_id and company_name."""
        task = self._make_task("https://example.com/privacy", company_name="AcmeCo")
        mock_client = MagicMock()
        mock_client.map_policy_urls.return_value = [
            "https://example.com/terms",
        ]

        new_tasks = discover_missing_urls(mock_client, [task])

        assert new_tasks[0].company_id == task.company_id
        assert new_tasks[0].company_name == "AcmeCo"

    def test_deduplicates_trailing_slashes(self):
        """URLs that differ only by trailing slash are considered duplicates."""
        task = self._make_task("https://example.com/privacy/")
        mock_client = MagicMock()
        mock_client.map_policy_urls.return_value = [
            "https://example.com/privacy",  # Same as task URL without slash
        ]

        new_tasks = discover_missing_urls(mock_client, [task])

        assert len(new_tasks) == 0

    def test_handles_map_failure(self):
        """map() failure returns empty list, doesn't crash."""
        task = self._make_task("https://example.com/privacy")
        mock_client = MagicMock()
        mock_client.map_policy_urls.return_value = []

        new_tasks = discover_missing_urls(mock_client, [task])

        assert len(new_tasks) == 0

    def test_multiple_companies(self):
        """Discovery runs separately for each company domain."""
        id1, id2 = uuid4(), uuid4()
        tasks = [
            ScrapingTask(company_id=id1, company_name="Co1", category="ai",
                        policy_url="https://co1.com/privacy", policy_type="privacy"),
            ScrapingTask(company_id=id2, company_name="Co2", category="ai",
                        policy_url="https://co2.com/terms", policy_type="tos"),
        ]
        mock_client = MagicMock()
        mock_client.map_policy_urls.side_effect = [
            ["https://co1.com/terms"],   # New for Co1
            ["https://co2.com/privacy"],  # New for Co2
        ]

        new_tasks = discover_missing_urls(mock_client, tasks)

        assert len(new_tasks) == 2
        assert mock_client.map_policy_urls.call_count == 2

    def test_no_duplicates_within_discovery(self):
        """If map() returns the same URL twice, it's only added once."""
        task = self._make_task("https://example.com/privacy")
        mock_client = MagicMock()
        mock_client.map_policy_urls.return_value = [
            "https://example.com/terms",
            "https://example.com/terms",  # Duplicate
            "https://example.com/terms/",  # Trailing slash variant
        ]

        new_tasks = discover_missing_urls(mock_client, [task])

        assert len(new_tasks) == 1
