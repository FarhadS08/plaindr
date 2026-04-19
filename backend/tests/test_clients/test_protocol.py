"""Tests for scraper protocols — verify structural subtyping contracts."""

from unittest.mock import MagicMock

from plaindr.clients.protocol import (
    AgentProtocol,
    HybridScraper,
    ScraperProtocol,
    UrlDiscoveryProtocol,
)


class TestScraperProtocolConformance:
    def test_firecrawl_satisfies_scraper_protocol(self):
        """FirecrawlClient structurally satisfies ScraperProtocol."""
        from plaindr.clients.firecrawl import FirecrawlClient

        # FirecrawlClient.__init__ requires settings, so check methods exist
        assert hasattr(FirecrawlClient, "scrape")
        assert hasattr(FirecrawlClient, "scrape_with_actions")
        assert hasattr(FirecrawlClient, "scrape_with_pagination")
        assert hasattr(FirecrawlClient, "extract_pdf")
        assert hasattr(FirecrawlClient, "extract_iframe_urls")

    def test_firecrawl_satisfies_agent_protocol(self):
        """FirecrawlClient structurally satisfies AgentProtocol."""
        from plaindr.clients.firecrawl import FirecrawlClient

        assert hasattr(FirecrawlClient, "agent_extract_policy")

    def test_firecrawl_satisfies_discovery_protocol(self):
        """FirecrawlClient structurally satisfies UrlDiscoveryProtocol."""
        from plaindr.clients.firecrawl import FirecrawlClient

        assert hasattr(FirecrawlClient, "map_policy_urls")

    def test_playwright_satisfies_scraper_protocol(self):
        """PlaywrightClient structurally satisfies ScraperProtocol."""
        from plaindr.clients.playwright import PlaywrightClient

        assert hasattr(PlaywrightClient, "scrape")
        assert hasattr(PlaywrightClient, "scrape_with_actions")
        assert hasattr(PlaywrightClient, "scrape_with_pagination")
        assert hasattr(PlaywrightClient, "extract_pdf")
        assert hasattr(PlaywrightClient, "extract_iframe_urls")

    def test_playwright_does_not_satisfy_agent_protocol(self):
        """PlaywrightClient does NOT have agent_extract_policy."""
        from plaindr.clients.playwright import PlaywrightClient

        assert not hasattr(PlaywrightClient, "agent_extract_policy")

    def test_playwright_does_not_satisfy_discovery_protocol(self):
        """PlaywrightClient does NOT have map_policy_urls."""
        from plaindr.clients.playwright import PlaywrightClient

        assert not hasattr(PlaywrightClient, "map_policy_urls")

    def test_mock_works_as_scraper(self):
        """MagicMock can be used in place of ScraperProtocol in tests.

        MagicMock doesn't pass isinstance() for runtime_checkable Protocols,
        but it works via __getattr__ magic — all method calls succeed.
        """
        mock = MagicMock()
        # Methods are callable and return MagicMock
        assert callable(mock.scrape)
        assert callable(mock.scrape_with_actions)
        assert callable(mock.extract_pdf)

    def test_hybrid_satisfies_scraper_protocol(self):
        """HybridScraper satisfies ScraperProtocol."""
        assert hasattr(HybridScraper, "scrape")
        assert hasattr(HybridScraper, "scrape_with_actions")
        assert hasattr(HybridScraper, "scrape_with_pagination")
        assert hasattr(HybridScraper, "extract_pdf")
        assert hasattr(HybridScraper, "extract_iframe_urls")
