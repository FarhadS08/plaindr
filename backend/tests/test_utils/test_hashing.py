"""Tests for MD5 content hashing utility."""

from plaindr.utils.hashing import md5_hash


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
