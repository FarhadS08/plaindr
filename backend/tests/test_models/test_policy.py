"""Tests for PolicyDocument model validation."""

from datetime import date, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from plaindr.models.policy import PolicyDocument
from plaindr.utils.hashing import md5_hash

_VALID_CONTENT = (
    "# Privacy Policy\n\n"
    "We care about your data. This privacy policy explains how we collect, "
    "use, and protect your personal information when you use our services."
)

VALID_POLICY = dict(
    id=md5_hash(_VALID_CONTENT),
    author_id=uuid4(),
    title="Privacy Policy",
    policy_type="general",
    source_url="https://example.com/privacy",
    content=_VALID_CONTENT,
)


class TestPolicyDocumentValid:
    def test_minimal(self):
        doc = PolicyDocument(**VALID_POLICY)
        assert doc.version == 1
        assert doc.effective_date is None
        assert doc.previous_version_id is None
        assert doc.summary is None

    def test_all_fields(self):
        doc = PolicyDocument(
            **VALID_POLICY,
            version=3,
            effective_date=date(2025, 6, 1),
            scraped_at=datetime(2025, 6, 1, 10, 0),
            previous_version_id="a" * 32,
            summary="A short summary.",
        )
        assert doc.version == 3
        assert doc.effective_date == date(2025, 6, 1)
        assert doc.previous_version_id == "a" * 32
        assert doc.summary == "A short summary."

    def test_scraped_at_defaults_to_now(self):
        doc = PolicyDocument(**VALID_POLICY)
        assert isinstance(doc.scraped_at, datetime)

    def test_version_defaults_to_one(self):
        doc = PolicyDocument(**VALID_POLICY)
        assert doc.version == 1


class TestPolicyDocumentInvalid:
    def test_missing_id(self):
        data = {k: v for k, v in VALID_POLICY.items() if k != "id"}
        with pytest.raises(ValidationError):
            PolicyDocument(**data)

    def test_missing_author_id(self):
        data = {k: v for k, v in VALID_POLICY.items() if k != "author_id"}
        with pytest.raises(ValidationError):
            PolicyDocument(**data)

    def test_missing_content(self):
        data = {k: v for k, v in VALID_POLICY.items() if k != "content"}
        with pytest.raises(ValidationError):
            PolicyDocument(**data)

    def test_invalid_source_url(self):
        data = {**VALID_POLICY, "source_url": "not-a-url"}
        with pytest.raises(ValidationError):
            PolicyDocument(**data)

    def test_invalid_author_id_type(self):
        data = {**VALID_POLICY, "author_id": "not-a-uuid"}
        with pytest.raises(ValidationError):
            PolicyDocument(**data)

    def test_empty_content(self):
        data = {**VALID_POLICY, "content": ""}
        with pytest.raises(ValidationError, match="empty"):
            PolicyDocument(**data)

    def test_too_short_content(self):
        data = {**VALID_POLICY, "content": "Short."}
        with pytest.raises(ValidationError, match="too short"):
            PolicyDocument(**data)

    def test_non_md5_id(self):
        data = {**VALID_POLICY, "id": "not-an-md5-hash"}
        with pytest.raises(ValidationError, match="MD5"):
            PolicyDocument(**data)
