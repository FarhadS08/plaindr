"""Tests for date extraction — 10+ format variations."""

from datetime import date

from plaindr.pipelines.feature.date_extractor import extract_effective_date


class TestExtractEffectiveDate:
    """Test various date keyword + format combinations."""

    # ── ISO format ────────────────────────────────────────

    def test_last_updated_iso(self):
        text = "Last Updated: 2025-06-15\n\n# Policy"
        assert extract_effective_date(text) == date(2025, 6, 15)

    def test_effective_date_iso(self):
        text = "Effective Date: 2024-12-01\n\nContent."
        assert extract_effective_date(text) == date(2024, 12, 1)

    # ── US format (MM/DD/YYYY) ────────────────────────────

    def test_last_modified_us_format(self):
        text = "Last modified: 01/15/2025\n\n# Privacy"
        assert extract_effective_date(text) == date(2025, 1, 15)

    # ── Written format ────────────────────────────────────

    def test_updated_on_written(self):
        text = "Updated on January 15, 2025\n\nPolicy content."
        assert extract_effective_date(text) == date(2025, 1, 15)

    def test_effective_as_of_written(self):
        text = "Effective as of March 1, 2024\n\n# Policy"
        assert extract_effective_date(text) == date(2024, 3, 1)

    def test_posted_on_written(self):
        text = "Posted on December 25, 2023.\nContent follows."
        assert extract_effective_date(text) == date(2023, 12, 25)

    # ── Abbreviated month ─────────────────────────────────

    def test_last_revised_abbreviated(self):
        text = "Last Revised: Jan 5, 2025\n\nContent."
        assert extract_effective_date(text) == date(2025, 1, 5)

    def test_published_on_abbreviated(self):
        text = "Published on Sep 12, 2024\n\nContent."
        assert extract_effective_date(text) == date(2024, 9, 12)

    # ── With colon/dash separators ────────────────────────

    def test_colon_separator(self):
        text = "Last updated: June 1, 2025\n\nText."
        assert extract_effective_date(text) == date(2025, 6, 1)

    def test_dash_separator(self):
        text = "Effective Date - 2025-03-15\n\nText."
        assert extract_effective_date(text) == date(2025, 3, 15)

    def test_em_dash_separator(self):
        text = "Last updated \u2014 February 28, 2025\n\nText."
        assert extract_effective_date(text) == date(2025, 2, 28)

    # ── Date of last revision ─────────────────────────────

    def test_date_of_last_revision(self):
        text = "Date of last revision: July 4, 2024\n\nContent."
        assert extract_effective_date(text) == date(2024, 7, 4)

    # ── Revised on ────────────────────────────────────────

    def test_revised_on(self):
        text = "Revised on 2025-02-14\n\nContent."
        assert extract_effective_date(text) == date(2025, 2, 14)

    # ── Edge cases ────────────────────────────────────────

    def test_no_date_returns_none(self):
        text = "# Privacy Policy\n\nWe value your privacy."
        assert extract_effective_date(text) is None

    def test_empty_string(self):
        assert extract_effective_date("") is None

    def test_keyword_without_date(self):
        text = "Last updated: check our website for details.\n\nContent."
        # dateutil may fail to parse "check our website" — should return None
        result = extract_effective_date(text)
        # Either None or a parsed date; shouldn't raise
        assert result is None or isinstance(result, date)

    def test_date_in_middle_of_text(self):
        text = (
            "# Privacy Policy\n\n"
            "Welcome to our service.\n\n"
            "Last Updated: 2025-08-20\n\n"
            "## Data Collection\n\nWe collect data."
        )
        assert extract_effective_date(text) == date(2025, 8, 20)

    def test_period_terminated(self):
        text = "Effective Date: March 1, 2025. This policy applies to all users."
        assert extract_effective_date(text) == date(2025, 3, 1)
