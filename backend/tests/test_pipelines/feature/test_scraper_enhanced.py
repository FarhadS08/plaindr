"""Tests for enhanced scraper — PDF, iframe, multi-page, smart escalation."""

from unittest.mock import MagicMock
from uuid import uuid4

from plaindr.pipelines.feature.csv_loader import ScrapingTask
from plaindr.pipelines.feature.scraper import (
    _is_pdf_url,
    scrape_task,
    scrape_task_with_escalation,
)

# NOTE: scrape_task now accepts `agent: AgentProtocol | None` for Tier 2.
# Tests that exercise Tier 2 (Spark agent) must pass agent=mock_client.
# Tests that only use Tier 1/3 can omit it (defaults to None).


def _make_task(url="https://example.com/privacy", policy_type="privacy"):
    return ScrapingTask(
        company_id=uuid4(),
        company_name="Test",
        category="ai",
        policy_url=url,
        policy_type=policy_type,
    )


class TestIsPdfUrl:
    def test_pdf_extension(self):
        assert _is_pdf_url("https://example.com/doc.pdf")

    def test_pdf_with_query_params(self):
        assert _is_pdf_url("https://example.com/doc.pdf?v=2")

    def test_not_pdf(self):
        assert not _is_pdf_url("https://example.com/privacy")

    def test_pdf_in_path_not_extension(self):
        assert not _is_pdf_url("https://example.com/pdf/document")

    def test_uppercase_pdf(self):
        assert _is_pdf_url("https://example.com/doc.PDF")


class TestScrapeTaskPdf:
    def test_pdf_url_triggers_extraction(self):
        """PDF URLs bypass the 3-tier cascade and go to extract_pdf."""
        task = _make_task("https://example.com/policy.pdf")
        mock_client = MagicMock()
        mock_client.extract_pdf.return_value = "# Policy\n\nFull text here."

        result = scrape_task(mock_client, task)

        assert result.success
        assert result.pdf_extracted
        assert "Full text here" in result.raw_markdown
        mock_client.extract_pdf.assert_called_once()
        mock_client.scrape_with_pagination.assert_not_called()

    def test_pdf_extraction_failure(self):
        task = _make_task("https://example.com/policy.pdf")
        mock_client = MagicMock()
        mock_client.extract_pdf.return_value = ""

        result = scrape_task(mock_client, task)

        assert not result.success
        assert result.pdf_extracted
        assert "PDF extraction" in result.error


class TestScrapeTaskIframe:
    def test_iframe_content_appended(self):
        """Iframe policy content is detected and appended to main content."""
        task = _make_task()
        mock_client = MagicMock()
        mock_client.scrape_with_pagination.return_value = (
            "# Privacy Policy\n\n" + "x" * 300
        )
        mock_client.extract_iframe_urls.return_value = [
            "https://compliance.example.com/dpa"
        ]
        mock_client.scrape.return_value = "# DPA\n\nData processing agreement text."

        result = scrape_task(mock_client, task)

        assert result.success
        assert len(result.iframe_content) == 1
        assert "Data processing agreement" in result.raw_markdown

    def test_no_iframes_found(self):
        task = _make_task()
        mock_client = MagicMock()
        mock_client.scrape_with_pagination.return_value = "# Privacy\n\n" + "x" * 300
        mock_client.extract_iframe_urls.return_value = []

        result = scrape_task(mock_client, task)

        assert result.success
        assert len(result.iframe_content) == 0


class TestScrapeTaskTierCascade:
    def test_tier1_sufficient(self):
        """Tier 1 returns enough content — no escalation."""
        task = _make_task()
        mock_client = MagicMock()
        mock_client.scrape_with_pagination.return_value = "# Policy\n\n" + "x" * 300
        mock_client.extract_iframe_urls.return_value = []

        result = scrape_task(mock_client, task)

        assert result.success
        assert result.tier_used == 1
        mock_client.agent_extract_policy.assert_not_called()

    def test_tier1_insufficient_escalates_to_tier2(self):
        """Tier 1 returns < 200 chars — escalates to Spark agent."""
        task = _make_task()
        mock_client = MagicMock()
        mock_client.scrape_with_pagination.return_value = "Short."
        mock_client.agent_extract_policy.return_value = "# Full Policy\n\n" + "x" * 500
        mock_client.extract_iframe_urls.return_value = []

        result = scrape_task(mock_client, task, agent=mock_client)

        assert result.success
        assert result.tier_used == 2
        mock_client.agent_extract_policy.assert_called_once()

    def test_all_tiers_fail(self):
        """All tiers return empty — failure."""
        task = _make_task()
        mock_client = MagicMock()
        mock_client.scrape_with_pagination.return_value = ""
        mock_client.agent_extract_policy.return_value = ""
        mock_client.scrape.return_value = ""

        result = scrape_task(mock_client, task, agent=mock_client)

        assert not result.success
        assert "all 3" in result.error.lower()


class TestSmartEscalation:
    def test_escalation_bypasses_tier1(self):
        """Smart escalation goes straight to Spark, skipping Tier 1."""
        task = _make_task()
        mock_client = MagicMock()
        mock_client.agent_extract_policy.return_value = "# Real Policy\n\n" + "x" * 500

        result = scrape_task_with_escalation(
            mock_client, task, "Quality score too low",
            agent=mock_client,
        )

        assert result.success
        assert result.tier_used == 2
        mock_client.scrape_with_pagination.assert_not_called()

    def test_escalation_failure(self):
        """Smart escalation fails — error includes original reason."""
        task = _make_task()
        mock_client = MagicMock()
        mock_client.agent_extract_policy.return_value = ""
        mock_client.scrape.return_value = ""

        result = scrape_task_with_escalation(
            mock_client, task, "Detected marketing page",
            agent=mock_client,
        )

        assert not result.success
        assert "Detected marketing page" in result.error
