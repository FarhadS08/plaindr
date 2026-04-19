"""Tests for CompanyDocument model validation."""

import pytest
from pydantic import ValidationError

from plaindr.models.company import CompanyDocument


class TestCompanyDocumentValid:
    """Valid CompanyDocument construction."""

    def test_minimal_fields(self):
        company = CompanyDocument(
            name="OpenAI",
            category="coding",
            main_url="https://openai.com",
        )
        assert company.name == "OpenAI"
        assert company.category == "coding"
        assert company.id is not None

    def test_id_auto_generated(self):
        a = CompanyDocument(name="A", category="a", main_url="https://a.com")
        b = CompanyDocument(name="B", category="b", main_url="https://b.com")
        assert a.id != b.id

    def test_explicit_id(self):
        from uuid import UUID

        uid = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
        company = CompanyDocument(
            id=uid,
            name="Test",
            category="test",
            main_url="https://test.com",
        )
        assert company.id == uid

    def test_url_normalised(self):
        company = CompanyDocument(
            name="Test",
            category="test",
            main_url="https://example.com/path",
        )
        assert str(company.main_url).startswith("https://")


class TestCompanyDocumentInvalid:
    """CompanyDocument rejects bad inputs."""

    def test_missing_name(self):
        with pytest.raises(ValidationError):
            CompanyDocument(category="x", main_url="https://x.com")

    def test_missing_category(self):
        with pytest.raises(ValidationError):
            CompanyDocument(name="X", main_url="https://x.com")

    def test_missing_url(self):
        with pytest.raises(ValidationError):
            CompanyDocument(name="X", category="x")

    def test_invalid_url(self):
        with pytest.raises(ValidationError):
            CompanyDocument(
                name="X",
                category="x",
                main_url="not-a-url",
            )

    def test_empty_string_url(self):
        with pytest.raises(ValidationError):
            CompanyDocument(
                name="X",
                category="x",
                main_url="",
            )
