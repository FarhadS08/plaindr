"""Tests for content refinement — cleaning, dedup, and document building."""

from datetime import date
from uuid import uuid4

from plaindr.pipelines.feature.csv_loader import ScrapingTask
from plaindr.pipelines.feature.refiner import (
    build_policy_document,
    clean_markdown,
    is_duplicate,
)
from plaindr.utils.hashing import md5_hash


class TestCleanMarkdown:
    def test_strips_cookie_banner(self):
        raw = (
            "# Policy\n\n"
            "We use cookies to improve your experience.\n\n"
            "Real content here."
        )
        cleaned = clean_markdown(raw)
        assert "cookies" not in cleaned.lower()
        assert "Real content here" in cleaned

    def test_strips_accept_cookies(self):
        raw = "Accept all cookies\n\n# Policy\n\nContent."
        cleaned = clean_markdown(raw)
        assert "Accept all cookies" not in cleaned

    def test_strips_cookie_settings(self):
        raw = "Cookie Settings\n\n# Policy\n\nContent."
        cleaned = clean_markdown(raw)
        assert "Cookie Settings" not in cleaned

    def test_strips_skip_to_content(self):
        raw = "Skip to main content\n\n# Policy\n\nContent."
        cleaned = clean_markdown(raw)
        assert "Skip to main content" not in cleaned

    def test_strips_back_to_top(self):
        raw = "# Policy\n\nContent.\n\nBack to top"
        cleaned = clean_markdown(raw)
        assert "Back to top" not in cleaned

    def test_strips_copyright(self):
        raw = "# Policy\n\nContent.\n\n\u00a9 2025 Company Inc."
        cleaned = clean_markdown(raw)
        assert "\u00a9" not in cleaned

    def test_removes_non_ascii(self):
        raw = "# Policy\n\nSmart \u201cquotes\u201d and em\u2014dashes."
        cleaned = clean_markdown(raw)
        assert "\u201c" not in cleaned
        assert "\u201d" not in cleaned
        assert "\u2014" not in cleaned

    def test_collapses_blank_lines(self):
        raw = "# Policy\n\n\n\n\n\nContent."
        cleaned = clean_markdown(raw)
        assert "\n\n\n" not in cleaned

    def test_collapses_multiple_spaces(self):
        raw = "# Policy\n\nMultiple   spaces    here."
        cleaned = clean_markdown(raw)
        assert "  " not in cleaned

    def test_strips_surrounding_whitespace(self):
        raw = "   \n\n# Policy\n\nContent.\n\n   "
        cleaned = clean_markdown(raw)
        assert not cleaned.startswith(" ")
        assert not cleaned.endswith(" ")
        assert not cleaned.startswith("\n")
        assert not cleaned.endswith("\n")

    def test_preserves_markdown_headings(self):
        raw = "# Title\n\n## Section One\n\nBody text."
        cleaned = clean_markdown(raw)
        assert "# Title" in cleaned
        assert "## Section One" in cleaned

    def test_preserves_paragraph_breaks(self):
        raw = "# Title\n\nParagraph one.\n\nParagraph two."
        cleaned = clean_markdown(raw)
        assert "\n\n" in cleaned

    def test_empty_input(self):
        assert clean_markdown("") == ""

    def test_only_noise(self):
        raw = "We use cookies\nSkip to content\nBack to top"
        cleaned = clean_markdown(raw)
        assert cleaned == ""

    def test_strips_language_picker(self):
        """Regression: OpenAI policy pages emit a language-picker
        dropdown whose second line concatenates every locale name
        into a no-space run (ArmenianbosanskiBurmese…). Both the
        'Select language' label and the concatenated line must go."""
        raw = (
            "OpenAI Data Processing Addendum | OpenAI\n\n"
            "Select language\n\n"
            "English (United States)ArmenianbosanskiBurmesecatalhrvatski"
            "etinadanskNederlandseestisuomifranais\n\n"
            "# Data Processing Addendum\n\n"
            "Real policy content starts here."
        )
        cleaned = clean_markdown(raw)
        assert "Select language" not in cleaned
        assert "Armenianbosanski" not in cleaned
        assert "Real policy content" in cleaned

    def test_strips_image_in_link_header(self):
        """Regression: Perplexity policies begin with a logo image
        wrapped in an anchor — '[![](logo.png)](https://perplexity.ai/)'
        — which is navigation chrome, not policy content."""
        raw = (
            "[![](https://cdn.example.com/logo.png)](https://example.com/)"
            " [Blog](https://example.com/blog) [Research](https://example.com/research)\n\n"
            "# Privacy Policy\n\n"
            "We process your data as described below."
        )
        cleaned = clean_markdown(raw)
        assert "logo.png" not in cleaned
        assert "Blog" not in cleaned
        assert "We process your data" in cleaned

    def test_strips_nav_link_strip(self):
        """Three or more back-to-back markdown links on a single line
        are always nav chrome at page edges, never body content."""
        raw = (
            "[Home](/) [Products](/products) [About](/about) [Contact](/contact)\n\n"
            "# Terms of Service\n\n"
            "These terms govern your use of the service."
        )
        cleaned = clean_markdown(raw)
        assert "[Home]" not in cleaned
        assert "[Contact]" not in cleaned
        assert "These terms govern" in cleaned

    def test_preserves_pair_of_inline_links_in_body(self):
        """The nav-strip pattern only fires on 3+ links on one line;
        legitimate body prose with 1-2 inline links must survive."""
        raw = (
            "# Privacy Policy\n\n"
            "You can reach us at [our support page](https://example.com/support) "
            "or see the [data request form](https://example.com/dsr) for GDPR requests."
        )
        cleaned = clean_markdown(raw)
        assert "[our support page]" in cleaned
        assert "[data request form]" in cleaned


# Realistic content that passes the model's minimum length validator.
_VALID_CONTENT = (
    "# Privacy Policy\n\n"
    "We collect and process your personal data in accordance with applicable "
    "data protection laws and our commitment to user privacy."
)
_ALT_CONTENT_A = (
    "This privacy policy describes how we handle personal information "
    "and protect user data across all of our services and platforms."
)
_ALT_CONTENT_B = (
    "Our terms of service govern your use of the platform and describe "
    "your rights and obligations as a user of our services and products."
)


class TestBuildPolicyDocument:
    def test_creates_document_with_md5_id(self):
        task = ScrapingTask(
            company_id=uuid4(),
            company_name="Test",
            category="coding",
            policy_url="https://example.com/privacy",
            policy_type="general",
        )
        doc = build_policy_document(task, _VALID_CONTENT)

        assert doc.id == md5_hash(_VALID_CONTENT)
        assert doc.author_id == task.company_id
        assert doc.title == "Test"
        assert doc.policy_type == "general"
        assert str(doc.source_url) == "https://example.com/privacy"
        assert doc.content == _VALID_CONTENT

    def test_effective_date_passed_through(self):
        task = ScrapingTask(
            company_id=uuid4(),
            company_name="Test",
            category="coding",
            policy_url="https://example.com/privacy",
            policy_type="general",
        )
        doc = build_policy_document(
            task,
            _VALID_CONTENT,
            effective_date=date(2025, 3, 1),
        )
        assert doc.effective_date == date(2025, 3, 1)

    def test_no_effective_date(self):
        task = ScrapingTask(
            company_id=uuid4(),
            company_name="Test",
            category="coding",
            policy_url="https://example.com/privacy",
            policy_type="general",
        )
        doc = build_policy_document(task, _VALID_CONTENT)
        assert doc.effective_date is None


class TestIsDuplicate:
    def test_duplicate_detected(self):
        task = ScrapingTask(
            company_id=uuid4(),
            company_name="T",
            category="c",
            policy_url="https://e.com/p",
            policy_type="general",
        )
        doc = build_policy_document(task, _ALT_CONTENT_A)
        existing_ids = {doc.id}
        assert is_duplicate(doc, existing_ids) is True

    def test_not_duplicate(self):
        task = ScrapingTask(
            company_id=uuid4(),
            company_name="T",
            category="c",
            policy_url="https://e.com/p",
            policy_type="general",
        )
        doc = build_policy_document(task, _ALT_CONTENT_B)
        existing_ids = {"completely_different_hash"}
        assert is_duplicate(doc, existing_ids) is False

    def test_empty_existing_ids(self):
        task = ScrapingTask(
            company_id=uuid4(),
            company_name="T",
            category="c",
            policy_url="https://e.com/p",
            policy_type="general",
        )
        doc = build_policy_document(task, _ALT_CONTENT_A)
        assert is_duplicate(doc, set()) is False
