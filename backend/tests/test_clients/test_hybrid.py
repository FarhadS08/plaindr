"""Tests for HybridScraper — primary + fallback behavior."""

from unittest.mock import MagicMock

from plaindr.clients.protocol import HybridScraper


class TestHybridScraperFallback:
    def _make_hybrid(self):
        primary = MagicMock()
        fallback = MagicMock()
        return HybridScraper(primary=primary, fallback=fallback), primary, fallback

    def test_primary_succeeds(self):
        """Primary returns content — fallback is NOT called."""
        hybrid, primary, fallback = self._make_hybrid()
        primary.scrape.return_value = "# Privacy Policy\n\nFull text."

        result = hybrid.scrape("https://example.com/privacy")

        assert "Full text" in result
        primary.scrape.assert_called_once()
        fallback.scrape.assert_not_called()

    def test_primary_empty_triggers_fallback(self):
        """Primary returns empty — fallback is called."""
        hybrid, primary, fallback = self._make_hybrid()
        primary.scrape.return_value = ""
        fallback.scrape.return_value = "# Policy from fallback"

        result = hybrid.scrape("https://example.com/privacy")

        assert "fallback" in result
        fallback.scrape.assert_called_once()

    def test_primary_whitespace_triggers_fallback(self):
        """Primary returns only whitespace — treated as empty."""
        hybrid, primary, fallback = self._make_hybrid()
        primary.scrape.return_value = "   \n\n  "
        fallback.scrape.return_value = "# Real content"

        result = hybrid.scrape("https://example.com/privacy")

        assert "Real content" in result

    def test_primary_exception_triggers_fallback(self):
        """Primary raises exception — fallback is called."""
        hybrid, primary, fallback = self._make_hybrid()
        primary.scrape.side_effect = Exception("Connection refused")
        fallback.scrape.return_value = "# Recovered content"

        result = hybrid.scrape("https://example.com/privacy")

        assert "Recovered" in result

    def test_scrape_with_actions_fallback(self):
        """scrape_with_actions also falls back correctly."""
        hybrid, primary, fallback = self._make_hybrid()
        primary.scrape_with_actions.return_value = ""
        fallback.scrape_with_actions.return_value = "# Actions result"

        result = hybrid.scrape_with_actions("https://example.com/terms")

        assert "Actions result" in result

    def test_scrape_with_pagination_fallback(self):
        """scrape_with_pagination also falls back correctly."""
        hybrid, primary, fallback = self._make_hybrid()
        primary.scrape_with_pagination.side_effect = TimeoutError("slow")
        fallback.scrape_with_pagination.return_value = "# Paginated content"

        result = hybrid.scrape_with_pagination("https://example.com/tos")

        assert "Paginated content" in result

    def test_extract_pdf_fallback(self):
        """extract_pdf falls back on primary failure."""
        hybrid, primary, fallback = self._make_hybrid()
        primary.extract_pdf.return_value = ""
        fallback.extract_pdf.return_value = "# PDF text"

        result = hybrid.extract_pdf("https://example.com/doc.pdf")

        assert "PDF text" in result


class TestHybridScraperIframes:
    def test_iframe_urls_merged(self):
        """Iframe detection merges results from both scrapers."""
        primary = MagicMock()
        fallback = MagicMock()
        hybrid = HybridScraper(primary=primary, fallback=fallback)

        primary.extract_iframe_urls.return_value = [
            "https://compliance.example.com/dpa",
        ]
        fallback.extract_iframe_urls.return_value = [
            "https://compliance.example.com/dpa",  # Duplicate
            "https://legal.example.com/terms",       # New
        ]

        result = hybrid.extract_iframe_urls("https://example.com/privacy")

        assert len(result) == 2
        assert "https://compliance.example.com/dpa" in result
        assert "https://legal.example.com/terms" in result

    def test_iframe_primary_failure_still_returns_fallback(self):
        """Primary iframe detection fails — fallback results still returned."""
        primary = MagicMock()
        fallback = MagicMock()
        hybrid = HybridScraper(primary=primary, fallback=fallback)

        primary.extract_iframe_urls.side_effect = Exception("Timeout")
        fallback.extract_iframe_urls.return_value = [
            "https://compliance.example.com/dpa",
        ]

        result = hybrid.extract_iframe_urls("https://example.com/privacy")

        assert len(result) == 1

    def test_both_empty(self):
        """Both scrapers return no iframes — empty list."""
        primary = MagicMock()
        fallback = MagicMock()
        hybrid = HybridScraper(primary=primary, fallback=fallback)

        primary.extract_iframe_urls.return_value = []
        fallback.extract_iframe_urls.return_value = []

        result = hybrid.extract_iframe_urls("https://example.com/privacy")

        assert result == []
