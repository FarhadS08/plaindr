"""Tests for diff computation — known inputs, verify hunks and stats."""

from plaindr.pipelines.inference.differ import (
    DiffHunk,
    DiffLine,
    compute_diff,
    diff_summary_stats,
    diff_to_unified_text,
)


class TestComputeDiff:
    def test_identical_content_no_hunks(self):
        content = "# Policy\n\nNo changes."
        hunks = compute_diff(content, content)
        assert hunks == []

    def test_added_lines(self):
        old = "# Policy\n\nOriginal."
        new = "# Policy\n\nOriginal.\n\nNew paragraph added."
        hunks = compute_diff(old, new)

        assert len(hunks) >= 1
        all_lines = [line for h in hunks for line in h.lines]
        added = [dl for dl in all_lines if dl.type == "added"]
        assert len(added) > 0
        assert any("New paragraph" in dl.content for dl in added)

    def test_removed_lines(self):
        old = "# Policy\n\nParagraph one.\n\nParagraph two."
        new = "# Policy\n\nParagraph one."
        hunks = compute_diff(old, new)

        all_lines = [line for h in hunks for line in h.lines]
        removed = [dl for dl in all_lines if dl.type == "removed"]
        assert len(removed) > 0

    def test_modified_lines(self):
        old = "# Policy\n\nRetention period is 30 days."
        new = "# Policy\n\nRetention period is 90 days."
        hunks = compute_diff(old, new)

        all_lines = [line for h in hunks for line in h.lines]
        removed = [dl for dl in all_lines if dl.type == "removed"]
        added = [dl for dl in all_lines if dl.type == "added"]
        assert any("30" in dl.content for dl in removed)
        assert any("90" in dl.content for dl in added)

    def test_empty_old_all_added(self):
        hunks = compute_diff("", "New content.\nLine two.")
        all_lines = [line for h in hunks for line in h.lines]
        added = [dl for dl in all_lines if dl.type == "added"]
        assert len(added) >= 1

    def test_empty_new_all_removed(self):
        hunks = compute_diff("Old content.\nLine two.", "")
        all_lines = [line for h in hunks for line in h.lines]
        removed = [dl for dl in all_lines if dl.type == "removed"]
        assert len(removed) >= 1

    def test_context_lines_present(self):
        old = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8"
        new = "Line 1\nLine 2\nLine 3\nCHANGED\nLine 5\nLine 6\nLine 7\nLine 8"
        hunks = compute_diff(old, new)

        all_lines = [line for h in hunks for line in h.lines]
        context = [dl for dl in all_lines if dl.type == "context"]
        assert len(context) > 0

    def test_hunk_structure(self):
        old = "A\nB\nC"
        new = "A\nX\nC"
        hunks = compute_diff(old, new)

        assert len(hunks) >= 1
        hunk = hunks[0]
        assert isinstance(hunk, DiffHunk)
        assert isinstance(hunk.old_start, int)
        assert isinstance(hunk.new_start, int)
        assert all(isinstance(dl, DiffLine) for dl in hunk.lines)


class TestDiffToUnifiedText:
    def test_roundtrip_produces_valid_text(self):
        old = "# Policy\n\nOld text."
        new = "# Policy\n\nNew text."
        hunks = compute_diff(old, new)
        text = diff_to_unified_text(hunks)

        assert "@@" in text
        assert "+" in text or "-" in text

    def test_empty_hunks_empty_text(self):
        assert diff_to_unified_text([]) == ""


class TestDiffSummaryStats:
    def test_counts_added_and_removed(self):
        old = "A\nB\nC"
        new = "A\nX\nY\nC"
        hunks = compute_diff(old, new)
        stats = diff_summary_stats(hunks)

        assert "lines_added" in stats
        assert "lines_removed" in stats
        assert "hunks" in stats
        assert stats["lines_added"] >= 1
        assert stats["lines_removed"] >= 1
        assert stats["hunks"] >= 1

    def test_no_changes_zero_stats(self):
        stats = diff_summary_stats([])
        assert stats == {
            "lines_added": 0,
            "lines_removed": 0,
            "hunks": 0,
        }

    def test_only_additions(self):
        hunks = compute_diff("", "New line 1.\nNew line 2.")
        stats = diff_summary_stats(hunks)
        assert stats["lines_added"] >= 1
        assert stats["lines_removed"] == 0

    def test_only_removals(self):
        hunks = compute_diff("Old line 1.\nOld line 2.", "")
        stats = diff_summary_stats(hunks)
        assert stats["lines_removed"] >= 1
        assert stats["lines_added"] == 0

    def test_large_diff_stats(self):
        old = "\n".join(f"Line {i}" for i in range(100))
        new = "\n".join(f"Line {i}" for i in range(50, 150))
        hunks = compute_diff(old, new)
        stats = diff_summary_stats(hunks)

        assert stats["lines_added"] > 0
        assert stats["lines_removed"] > 0
        assert stats["hunks"] >= 1


class TestPhantomHunkFilter:
    """Regression tests for phantom hunks observed in production scrapes."""

    def test_monica_colon_space_phantom_dropped(self):
        # Real Monica v2 -> v3 noise: a single space appears after the
        # colon. Semantically identical, must not produce a hunk.
        old = (
            "We believe in earning and keeping your trust.\n"
            "Our mission is straightforward:to provide a privacy-focused tool "
            "that honors your personal and digital boundaries.\n"
            "We thrive on innovation."
        )
        new = (
            "We believe in earning and keeping your trust.\n"
            "Our mission is straightforward: to provide a privacy-focused tool "
            "that honors your personal and digital boundaries.\n"
            "We thrive on innovation."
        )
        assert compute_diff(old, new) == []

    def test_lovable_ok_permutation_phantom_dropped(self):
        # Real Lovable v2 -> v3 noise: button text "OK" concatenated with
        # link text "Manage preferences" in opposite orders across scrapes.
        old = "Some clause.\nOKManage preferences\nNext clause."
        new = "Some clause.\nManage preferencesOK\nNext clause."
        assert compute_diff(old, new) == []

    def test_punctuation_spacing_phantom_dropped(self):
        # Comma/spacing drift — identical once punctuation is stripped.
        old = "We collect data,sharing it with vendors."
        new = "We collect data, sharing it with vendors."
        assert compute_diff(old, new) == []

    def test_real_change_not_dropped(self):
        # Token multisets differ — must survive the filter.
        old = "Retention period is 30 days."
        new = "Retention period is 90 days."
        hunks = compute_diff(old, new)
        assert len(hunks) >= 1

    def test_long_permutation_not_dropped(self):
        # Over the 60-char cap: even if char multisets happen to match,
        # real long-form rewrites must not be dropped.
        old = "a" * 80
        new = "a" * 80 + " b"  # ensure real diff
        hunks = compute_diff(old, new)
        assert len(hunks) >= 1

    def test_pure_addition_not_dropped(self):
        # No removed lines — by definition a real addition, never phantom.
        old = "Existing clause."
        new = "Existing clause.\nNew clause added."
        hunks = compute_diff(old, new)
        assert len(hunks) >= 1

    def test_pure_deletion_not_dropped(self):
        old = "Existing clause.\nOld clause to remove."
        new = "Existing clause."
        hunks = compute_diff(old, new)
        assert len(hunks) >= 1
