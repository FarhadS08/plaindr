"""Tests for PlaywrightClient — HTML-to-Markdown conversion and shared utilities."""

from plaindr.clients._shared import (
    extract_iframe_urls_from_html,
    find_next_page_url,
    find_next_page_url_html,
    is_policy_iframe,
)
from plaindr.clients.playwright import _html_to_markdown


class TestHtmlToMarkdown:
    def test_preserves_headings(self):
        """HTML headings are converted to Markdown # syntax."""
        html = "<h1>Privacy Policy</h1><h2>Data Collection</h2><p>We collect data.</p>"
        md = _html_to_markdown(html)
        assert "# Privacy Policy" in md
        assert "## Data Collection" in md
        assert "We collect data" in md

    def test_strips_script_tags(self):
        """Script tags are removed entirely."""
        html = (
            "<p>Policy text</p>"
            "<script>alert('xss')</script>"
            "<p>More text</p>"
        )
        md = _html_to_markdown(html)
        assert "alert" not in md
        assert "Policy text" in md
        assert "More text" in md

    def test_strips_nav_tags(self):
        """Navigation elements are removed."""
        html = "<nav><a href='/'>Home</a></nav><p>Policy content here.</p>"
        md = _html_to_markdown(html)
        assert "Home" not in md
        assert "Policy content" in md

    def test_strips_footer_tags(self):
        """Footer elements are removed."""
        html = "<p>Policy</p><footer>Copyright 2026</footer>"
        md = _html_to_markdown(html)
        assert "Copyright" not in md
        assert "Policy" in md

    def test_preserves_lists(self):
        """HTML lists are converted to Markdown lists."""
        html = "<ul><li>Item one</li><li>Item two</li></ul>"
        md = _html_to_markdown(html)
        assert "Item one" in md
        assert "Item two" in md

    def test_preserves_links(self):
        """HTML links are converted to Markdown links."""
        html = '<p>See our <a href="/privacy">privacy policy</a>.</p>'
        md = _html_to_markdown(html)
        assert "privacy policy" in md

    def test_collapses_blank_lines(self):
        """Multiple blank lines are collapsed to double."""
        html = "<p>A</p><br><br><br><br><p>B</p>"
        md = _html_to_markdown(html)
        # Should not have more than 2 consecutive newlines
        assert "\n\n\n" not in md

    def test_empty_html(self):
        """Empty HTML returns empty string."""
        assert _html_to_markdown("") == ""

    def test_strips_style_tags(self):
        """Style tags are removed."""
        html = "<style>.policy { color: red; }</style><p>Real text</p>"
        md = _html_to_markdown(html)
        assert "color" not in md
        assert "Real text" in md


class TestSharedIframeFilter:
    def test_policy_iframe_accepted(self):
        assert is_policy_iframe("https://compliance.example.com/privacy-iframe")

    def test_tracking_iframe_rejected(self):
        assert not is_policy_iframe("https://www.google.com/recaptcha/api2")

    def test_youtube_rejected(self):
        assert not is_policy_iframe("https://www.youtube.com/embed/abc123")

    def test_dpa_iframe_accepted(self):
        assert is_policy_iframe("https://trust.example.com/dpa")


class TestSharedPaginationMarkdown:
    def test_finds_next_link(self):
        md = "Some content [next](https://example.com/page2) more content"
        result = find_next_page_url(md, "https://example.com/page1")
        assert result == "https://example.com/page2"

    def test_rejects_different_domain(self):
        md = "Content [next](https://evil.com/page2)"
        result = find_next_page_url(md, "https://example.com/page1")
        assert result is None

    def test_no_pagination(self):
        md = "Just regular policy content, no links."
        result = find_next_page_url(md, "https://example.com/page1")
        assert result is None


class TestSharedPaginationHtml:
    def test_finds_rel_next(self):
        html = '<link rel="next" href="/privacy/page2">'
        result = find_next_page_url_html(html, "https://example.com/privacy")
        assert result == "https://example.com/privacy/page2"

    def test_finds_next_link_text(self):
        html = '<a href="/terms/page2">Next</a>'
        result = find_next_page_url_html(html, "https://example.com/terms")
        assert result == "https://example.com/terms/page2"

    def test_rejects_different_domain(self):
        html = '<a href="https://evil.com/page2">Next</a>'
        result = find_next_page_url_html(html, "https://example.com/terms")
        assert result is None

    def test_no_pagination_found(self):
        html = "<p>Just a normal page</p>"
        result = find_next_page_url_html(html, "https://example.com/terms")
        assert result is None


class TestSharedIframeExtraction:
    def test_finds_policy_iframe(self):
        html = '<iframe src="https://compliance.example.com/privacy-embed"></iframe>'
        result = extract_iframe_urls_from_html(
            html, "https://example.com/privacy",
        )
        assert len(result) == 1
        assert "privacy-embed" in result[0]

    def test_filters_tracking_iframes(self):
        html = '<iframe src="https://www.google.com/recaptcha/api"></iframe>'
        result = extract_iframe_urls_from_html(
            html, "https://example.com/privacy",
        )
        assert len(result) == 0

    def test_resolves_relative_urls(self):
        html = '<iframe src="/legal/dpa-embed"></iframe>'
        result = extract_iframe_urls_from_html(
            html, "https://example.com/privacy",
        )
        assert len(result) == 1
        assert result[0] == "https://example.com/legal/dpa-embed"
