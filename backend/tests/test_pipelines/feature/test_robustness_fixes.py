"""Tests for scraping robustness fixes — edge-only cleaning,
expanded validator, Tier 3 retry, error categorization, completeness report."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

from plaindr.pipelines.feature.content_validator import validate_content
from plaindr.pipelines.feature.csv_loader import ScrapingTask
from plaindr.pipelines.feature.orchestrator import (
    CompletenessEntry,
    PipelineResult,
    _write_completeness_report,
)
from plaindr.pipelines.feature.refiner import clean_markdown
from plaindr.pipelines.feature.scraper import (
    ScrapeErrorType,
    _classify_error,
    _scrape_basic_with_retry,
)

# ── Fix 1: Edge-only cleaning ────────────────────────


class TestEdgeOnlyCleaning:
    def test_mid_document_by_continuing_preserved(self):
        """Legitimate 'by continuing' text in mid-document is NOT stripped."""
        lines = ["Line " + str(i) for i in range(50)]
        # Insert policy clause in the middle
        lines[25] = "By continuing to use our services, you consent to this policy."
        text = "\n".join(lines)
        cleaned = clean_markdown(text)
        assert "By continuing to use our services" in cleaned

    def test_cookie_banner_at_top_stripped(self):
        """Cookie banner in first 20 lines IS stripped."""
        text = "We use cookies to enhance your experience.\n" + "\n".join(
            ["Policy text line " + str(i) for i in range(50)]
        )
        cleaned = clean_markdown(text)
        assert "We use cookies" not in cleaned

    def test_cookie_banner_at_bottom_stripped(self):
        """Cookie/nav noise at end of document IS stripped."""
        lines = ["Policy text line " + str(i) for i in range(50)]
        lines.append("Accept all cookies")
        text = "\n".join(lines)
        cleaned = clean_markdown(text)
        assert "Accept all cookies" not in cleaned

    def test_copyright_at_bottom_stripped(self):
        """Copyright footer IS stripped (using actual © symbol)."""
        lines = ["Policy text line " + str(i) for i in range(50)]
        lines.append("\u00A9 2026 Company Inc.")
        text = "\n".join(lines)
        cleaned = clean_markdown(text)
        # The © gets normalized to (c) then the nav pattern strips the line
        assert "2026 Company Inc" not in cleaned

    def test_short_document_cleaned_everywhere(self):
        """Documents shorter than 40 lines are fully cleaned (all edge)."""
        text = "Accept all cookies\nPolicy text here.\nSkip to main content"
        cleaned = clean_markdown(text)
        assert "Accept all cookies" not in cleaned
        assert "Skip to main content" not in cleaned
        assert "Policy text here" in cleaned


# ── Fix 2: Expanded validator ────────────────────────


class TestExpandedValidator:
    def test_plain_language_policy_accepted(self):
        """Policy using plain language (no standard legal terms) can pass."""
        content = (
            "# How We Handle Your Data\n\n"
            "We collect information about you when you use our service. "
            "This includes your name, email, and usage patterns. "
            "We use this information to improve our products.\n\n"
            "## Information We Collect\n\n"
            "When you sign up, we collect your name and email address. "
            "We also collect information about how you use our services, "
            "including pages visited and features used.\n\n"
            "## How We Use Your Information\n\n"
            "We use your information to provide and improve our services. "
            "We may share your information with service providers who help "
            "us operate our platform.\n\n"
            "## Your Rights\n\n"
            "You can request access to your data at any time. "
            "You can also request that we delete your information. "
            "Contact us at privacy@example.com.\n\n"
            "## Data Security\n\n"
            "We take security measures to protect your information. "
            "This includes encryption and access controls."
        )
        result = validate_content(content, "https://example.com/privacy")
        assert result.is_valid

    def test_regional_regulation_terms_recognized(self):
        """PIPEDA, LGPD, PDPA terms count as strong policy indicators."""
        content = (
            "# Privacy Notice\n\n"
            "This notice is provided in accordance with PIPEDA and the "
            "Privacy Act. We comply with LGPD requirements for Brazilian "
            "users and PDPA for users in Singapore.\n\n"
            "## Data Processing Agreement\n\n"
            "Our DPA outlines how we process personal data as a data "
            "processor on behalf of our customers. We maintain compliance "
            "with all applicable data protection regulations.\n\n"
            "## Your Privacy Rights\n\n"
            "You have the right to access, right to delete, and right "
            "to portability of your personal information. You may opt out "
            "of data sharing at any time.\n\n" + "x " * 200
        )
        result = validate_content(content, "https://example.com/privacy")
        assert result.is_valid
        assert result.score >= 15

    def test_marketing_page_still_rejected(self):
        """Pure marketing content with no policy terms is rejected."""
        content = (
            "# The Best AI Tool for Your Business\n\n"
            "Transform your workflow with our cutting-edge AI solution. "
            "Our platform helps teams collaborate more effectively and "
            "deliver results faster than ever before. Join thousands "
            "of companies already using our technology.\n\n"
            "## Features\n\n"
            "- Real-time collaboration with team members across the globe\n"
            "- Advanced analytics dashboard with customizable reports\n"
            "- Seamless integration with popular tools and platforms\n"
            "- 24/7 customer support with dedicated account managers\n"
            "- Automated workflow builder for repetitive tasks\n\n"
            "## Pricing\n\n"
            "Start your free trial today! Plans start at just $9.99 per "
            "month. Enterprise plans available for larger teams with "
            "custom requirements and dedicated infrastructure."
        )
        result = validate_content(content, "https://example.com/product")
        assert not result.is_valid

    def test_429_error_page_detected(self):
        """Rate limit error pages are caught."""
        content = (
            "# 429 Too Many Requests\n\n"
            "You have exceeded the rate limit. Please try again later.\n"
            + "x " * 300  # Pad above 500 chars to reach error page gate
        )
        result = validate_content(content, "https://example.com/privacy")
        assert not result.is_valid
        assert "error page" in result.rejection_reason.lower()

    def test_503_error_page_detected(self):
        """Service unavailable pages are caught."""
        content = (
            "# Service Unavailable\n\n"
            "The service is temporarily unavailable. Please try again later.\n"
            + "x " * 300
        )
        result = validate_content(content, "https://example.com/privacy")
        assert not result.is_valid


# ── Fix 3: Tier 3 retry ─────────────────────────────


class TestTier3Retry:
    def test_basic_scrape_retries_on_failure(self):
        """Basic scrape retries when first attempt fails."""
        task = ScrapingTask(
            company_id=uuid4(),
            company_name="Test",
            category="ai",
            policy_url="https://example.com/privacy",
            policy_type="privacy",
        )
        mock_client = MagicMock()
        mock_client.scrape.side_effect = [
            Exception("Connection reset"),
            "# Privacy Policy\n\nFull text here.",
        ]

        with patch("plaindr.pipelines.feature.scraper.time.sleep"):
            result = _scrape_basic_with_retry(mock_client, task)

        assert "Full text here" in result
        assert mock_client.scrape.call_count == 2

    def test_basic_scrape_exhausts_retries(self):
        """Basic scrape returns empty after all retries fail."""
        task = ScrapingTask(
            company_id=uuid4(),
            company_name="Test",
            category="ai",
            policy_url="https://example.com/privacy",
            policy_type="privacy",
        )
        mock_client = MagicMock()
        mock_client.scrape.side_effect = Exception("Permanent failure")

        with patch("plaindr.pipelines.feature.scraper.time.sleep"):
            result = _scrape_basic_with_retry(mock_client, task)

        assert result == ""
        assert mock_client.scrape.call_count == 3


# ── Fix 9: Error categorization ─────────────────────


class TestErrorCategorization:
    def test_timeout_classified(self):
        assert _classify_error("Connection timed out") == ScrapeErrorType.TIMEOUT

    def test_rate_limit_classified(self):
        assert _classify_error("429 Too Many Requests") == ScrapeErrorType.RATE_LIMIT

    def test_auth_classified(self):
        assert _classify_error("401 Unauthorized") == ScrapeErrorType.AUTH_ERROR

    def test_network_classified(self):
        assert _classify_error("Connection refused") == ScrapeErrorType.NETWORK_ERROR

    def test_empty_response_classified(self):
        assert _classify_error("Empty response") == ScrapeErrorType.EMPTY_RESPONSE

    def test_pdf_classified(self):
        result = _classify_error("PDF extraction failed")
        assert result == ScrapeErrorType.PDF_EXTRACTION

    def test_unknown_classified(self):
        assert _classify_error("Something weird happened") == ScrapeErrorType.UNKNOWN

    def test_none_error(self):
        assert _classify_error(None) == ScrapeErrorType.NONE

    def test_exception_object(self):
        result = _classify_error(TimeoutError("deadline exceeded"))
        assert result == ScrapeErrorType.TIMEOUT

    def test_ssl_classified_as_network(self):
        result = _classify_error("SSL certificate verify failed")
        assert result == ScrapeErrorType.NETWORK_ERROR

    def test_dns_classified_as_network(self):
        assert _classify_error("DNS resolution failed") == ScrapeErrorType.NETWORK_ERROR

    def test_forbidden_classified_as_auth(self):
        assert _classify_error("403 Forbidden") == ScrapeErrorType.AUTH_ERROR


# ── Fix 10: Completeness report ──────────────────────


class TestCompletenessReport:
    def test_report_written(self, tmp_path):
        """Completeness report is written with entries."""
        result = PipelineResult(
            tasks_total=5,
            scrape_success=3,
            scrape_failed=2,
            completeness_entries=[
                CompletenessEntry(
                    level="FAILED",
                    url="https://example.com/privacy",
                    message="Timeout after 120s",
                    error_type="timeout",
                ),
                CompletenessEntry(
                    level="LOW_CONFIDENCE",
                    url="https://example.com/terms",
                    message="Accepted (score=9.0) — No strong policy terms",
                ),
            ],
        )
        with patch(
            "plaindr.pipelines.feature.orchestrator.Path",
            return_value=tmp_path / "logs" / "completeness",
        ):
            # Call directly with patched path
            report_path = _write_completeness_report(result, "test")

        assert report_path is not None
        content = report_path.read_text()
        assert "FAILED" in content
        assert "https://example.com/privacy" in content
        assert "Timeout after 120s" in content
        assert "LOW_CONFIDENCE" in content
        assert "Tasks total:       5" in content

    def test_no_report_when_clean(self):
        """No report file generated when there are no issues."""
        result = PipelineResult(
            tasks_total=5,
            scrape_success=5,
        )
        report_path = _write_completeness_report(result, "test")
        assert report_path is None
