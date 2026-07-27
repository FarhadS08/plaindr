"""Tests for MD5 content hashing utility."""

from plaindr.utils.hashing import md5_hash, normalize_for_meaning, semantic_hash


class TestMd5Hash:
    def test_same_content_same_hash(self):
        assert md5_hash("hello world") == md5_hash("hello world")

    def test_different_content_different_hash(self):
        assert md5_hash("hello") != md5_hash("world")

    def test_returns_32_char_hex(self):
        result = md5_hash("test")
        assert len(result) == 32
        assert all(c in "0123456789abcdef" for c in result)

    def test_empty_string(self):
        result = md5_hash("")
        assert len(result) == 32
        # Known MD5 of empty string
        assert result == "d41d8cd98f00b204e9800998ecf8427e"

    def test_whitespace_sensitivity(self):
        assert md5_hash("a b") != md5_hash("a  b")
        assert md5_hash("abc\n") != md5_hash("abc")

    def test_unicode_content(self):
        result = md5_hash("Hello 世界")
        assert len(result) == 32

    def test_long_content(self):
        long_text = "x" * 100_000
        result = md5_hash(long_text)
        assert len(result) == 32
        assert result == md5_hash(long_text)


class TestNormalizeForMeaning:
    """The meaning core must be invariant to cosmetic drift but sensitive
    to any real word/number change."""

    def test_whitespace_drift_collapses(self):
        assert normalize_for_meaning("a  b\tc\n") == "abc"
        assert normalize_for_meaning("data sharing") == normalize_for_meaning(
            "data   sharing"
        )

    def test_punctuation_drift_collapses(self):
        # The exact classes of phantom the user reported: comma, dot, space.
        assert normalize_for_meaning("data, sharing") == normalize_for_meaning(
            "data sharing"
        )
        assert normalize_for_meaning("mission:to help") == normalize_for_meaning(
            "mission: to help"
        )
        assert normalize_for_meaning("end.") == normalize_for_meaning("end")

    def test_case_insensitive(self):
        assert normalize_for_meaning("Privacy Policy") == normalize_for_meaning(
            "privacy policy"
        )

    def test_markdown_syntax_stripped(self):
        base = normalize_for_meaning("Retention period")
        assert normalize_for_meaning("*Retention* period") == base
        assert normalize_for_meaning("**Retention** period") == base
        assert normalize_for_meaning("_Retention_ period") == base
        assert normalize_for_meaning("## Retention period") == base
        assert normalize_for_meaning("- Retention period") == base

    def test_html_tags_stripped(self):
        assert normalize_for_meaning("<div>hello</div>") == "hello"
        assert normalize_for_meaning('<a href="x">hello</a>') == "hello"

    def test_thousands_separator_is_cosmetic(self):
        assert normalize_for_meaning("$1,000") == normalize_for_meaning("$1000")

    def test_numeric_change_preserved(self):
        assert normalize_for_meaning("30 days") != normalize_for_meaning("90 days")

    def test_word_change_preserved(self):
        assert normalize_for_meaning("we may share") != normalize_for_meaning(
            "we must share"
        )

    def test_empty_and_punctuation_only(self):
        assert normalize_for_meaning("") == ""
        assert normalize_for_meaning("   \n\t ") == ""
        assert normalize_for_meaning("!!!,,, ... --- ") == ""


class TestSemanticHash:
    def test_cosmetic_drift_same_hash(self):
        assert semantic_hash("We collect data, sharing it.") == semantic_hash(
            "We collect  data sharing it"
        )
        assert semantic_hash("Mission:to help") == semantic_hash("Mission: to help")

    def test_markdown_drift_same_hash(self):
        assert semantic_hash("*Retention*: 30 days") == semantic_hash(
            "Retention: 30 days"
        )

    def test_real_change_different_hash(self):
        assert semantic_hash("Retention is 30 days") != semantic_hash(
            "Retention is 90 days"
        )

    def test_returns_32_char_hex(self):
        result = semantic_hash("hello world")
        assert len(result) == 32
        assert all(c in "0123456789abcdef" for c in result)

    def test_deterministic(self):
        assert semantic_hash("Some policy text.") == semantic_hash(
            "Some policy text."
        )
