"""Tests for enhanced FirecrawlClient — iframe detection, pagination,
policy URL filtering."""

from plaindr.clients.firecrawl import _find_next_page_url, _is_policy_iframe


class TestIsPolicyIframe:
    def test_policy_iframe(self):
        assert _is_policy_iframe("https://compliance.example.com/privacy")

    def test_terms_iframe(self):
        assert _is_policy_iframe("https://legal.example.com/terms")

    def test_dpa_iframe(self):
        assert _is_policy_iframe("https://trust.example.com/dpa")

    def test_google_tracking_rejected(self):
        assert not _is_policy_iframe("https://www.google.com/maps/embed")

    def test_youtube_rejected(self):
        assert not _is_policy_iframe("https://www.youtube.com/embed/abc123")

    def test_facebook_rejected(self):
        assert not _is_policy_iframe("https://www.facebook.com/plugins/like")

    def test_googletagmanager_rejected(self):
        assert not _is_policy_iframe("https://www.googletagmanager.com/ns.html")

    def test_recaptcha_rejected(self):
        assert not _is_policy_iframe("https://www.google.com/recaptcha/api2/anchor")

    def test_generic_non_policy(self):
        assert not _is_policy_iframe("https://cdn.example.com/widget.html")


class TestFindNextPageUrl:
    def test_finds_next_link(self):
        markdown = (
            "# Page 1\n\nSome content here.\n\n"
            "[Next](https://example.com/privacy/page-2)"
        )
        result = _find_next_page_url(markdown, "https://example.com/privacy")
        assert result == "https://example.com/privacy/page-2"

    def test_finds_next_page_link(self):
        markdown = "Content.\n\n[Next Page](https://example.com/terms/2)"
        result = _find_next_page_url(markdown, "https://example.com/terms")
        assert result == "https://example.com/terms/2"

    def test_finds_continue_link(self):
        markdown = "Content.\n\n[Continue](https://example.com/privacy/part2)"
        result = _find_next_page_url(markdown, "https://example.com/privacy")
        assert result == "https://example.com/privacy/part2"

    def test_no_pagination(self):
        markdown = "# Full Policy\n\nAll content on one page."
        result = _find_next_page_url(markdown, "https://example.com/privacy")
        assert result is None

    def test_rejects_different_domain(self):
        markdown = "Content.\n\n[Next](https://evil.com/phishing)"
        result = _find_next_page_url(markdown, "https://example.com/privacy")
        assert result is None

    def test_case_insensitive(self):
        markdown = "Content.\n\n[NEXT](https://example.com/privacy/p2)"
        result = _find_next_page_url(markdown, "https://example.com/privacy")
        assert result == "https://example.com/privacy/p2"
