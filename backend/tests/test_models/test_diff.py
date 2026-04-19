"""Tests for diff domain models."""

from datetime import datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from plaindr.models.diff import (
    DiffDocument,
    PolicyChangeAnalysis,
    PolicyChangeItem,
)


class TestPolicyChangeItem:
    def test_valid(self):
        item = PolicyChangeItem(
            section="Data Retention",
            change_type="modified",
            description="Retention period extended from 30 to 90 days.",
            severity="warning",
        )
        assert item.section == "Data Retention"
        assert item.severity == "warning"

    def test_missing_field(self):
        with pytest.raises(ValidationError):
            PolicyChangeItem(
                section="X",
                change_type="added",
                # missing description and severity
            )


class TestPolicyChangeAnalysis:
    def test_valid(self):
        analysis = PolicyChangeAnalysis(
            summary="Minor updates to data handling.",
            key_changes=[
                PolicyChangeItem(
                    section="Sec",
                    change_type="added",
                    description="New clause.",
                    severity="info",
                )
            ],
            consequences="Users may see new consent prompts.",
            risk_level="low",
        )
        assert len(analysis.key_changes) == 1
        assert analysis.risk_level == "low"

    def test_empty_key_changes(self):
        analysis = PolicyChangeAnalysis(
            summary="No significant changes.",
            key_changes=[],
            consequences="None.",
            risk_level="low",
        )
        assert analysis.key_changes == []


class TestDiffDocument:
    def test_valid_minimal(self):
        doc = DiffDocument(
            id="old_new",
            source_url="https://example.com/privacy",
            author_id=uuid4(),
            old_version_id="old_hash",
            new_version_id="new_hash",
            old_version=1,
            new_version=2,
            diff_text="@@ -1,2 +1,3 @@\n context\n-old\n+new",
            stats={"lines_added": 1, "lines_removed": 1, "hunks": 1},
        )
        assert doc.analysis is None
        assert doc.analysis_status == "completed"
        assert doc.analysis_error is None
        assert isinstance(doc.computed_at, datetime)

    def test_with_analysis(self):
        analysis = PolicyChangeAnalysis(
            summary="Test.",
            key_changes=[],
            consequences="None.",
            risk_level="low",
        )
        doc = DiffDocument(
            id="old_new",
            source_url="https://example.com/privacy",
            author_id=uuid4(),
            old_version_id="old",
            new_version_id="new",
            old_version=1,
            new_version=2,
            diff_text="diff",
            stats={"lines_added": 0, "lines_removed": 0, "hunks": 0},
            analysis=analysis,
        )
        assert doc.analysis is not None
        assert doc.analysis.risk_level == "low"

    def test_invalid_source_url(self):
        with pytest.raises(ValidationError):
            DiffDocument(
                id="x",
                source_url="bad",
                author_id=uuid4(),
                old_version_id="a",
                new_version_id="b",
                old_version=1,
                new_version=2,
                diff_text="",
                stats={},
            )
