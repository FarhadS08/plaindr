"""Diff computation — structural comparison of policy versions
using Python's difflib."""

import difflib
import re
from dataclasses import dataclass, field
from typing import Literal

# Hunks shorter than this (after stripping whitespace) are eligible for
# the permutation check. Above this, two strings with the same character
# multiset are almost certainly a real rewrite rather than scraper noise.
_PERMUTATION_MAX_CHARS = 60


@dataclass
class DiffLine:
    """A single line in a diff hunk."""

    type: Literal["added", "removed", "unchanged", "context"]
    content: str
    old_line_number: int | None = None
    new_line_number: int | None = None


@dataclass
class DiffHunk:
    """A contiguous block of changes."""

    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: list[DiffLine] = field(default_factory=list)


def compute_diff(
    old_content: str,
    new_content: str,
) -> list[DiffHunk]:
    """Compute structural diff between two policy versions.

    Uses difflib.unified_diff internally, then parses the output
    into structured DiffHunk objects.
    """
    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)
    raw_diff = list(difflib.unified_diff(old_lines, new_lines, n=3))
    hunks = _parse_unified_diff(raw_diff)
    return [h for h in hunks if not _is_phantom_hunk(h)]


def diff_to_unified_text(hunks: list[DiffHunk]) -> str:
    """Convert structured hunks back to unified diff text."""
    lines: list[str] = []
    for hunk in hunks:
        header = (
            f"@@ -{hunk.old_start},{hunk.old_count} "
            f"+{hunk.new_start},{hunk.new_count} @@"
        )
        lines.append(header)
        for dl in hunk.lines:
            prefix = _type_to_prefix(dl.type)
            lines.append(f"{prefix}{dl.content}")
    return "\n".join(lines)


def diff_summary_stats(hunks: list[DiffHunk]) -> dict:
    """Compute summary statistics from diff hunks."""
    added = 0
    removed = 0
    for hunk in hunks:
        for line in hunk.lines:
            if line.type == "added":
                added += 1
            elif line.type == "removed":
                removed += 1

    return {
        "lines_added": added,
        "lines_removed": removed,
        "hunks": len(hunks),
    }


# ── Private helpers ──────────────────────────────────


def _phantom_normalize(text: str) -> str:
    """Reduce text to its phantom-comparison core.

    Drops everything that isn't a letter or digit (whitespace AND
    punctuation) and lowercases. So `: to`, `:to`, `data, sharing`
    and `data sharing` all collapse to the same string — formatting
    and punctuation-spacing drift become invisible.
    """
    return re.sub(r"[^\w]", "", text).lower()


def _is_phantom_hunk(hunk: DiffHunk) -> bool:
    """True if a hunk's removed/added lines are noise, not real change.

    Two patterns we drop:

    1. Whitespace/punctuation drift — `: to` vs `:to`, or `data,sharing`
       vs `data sharing`, read as diffs to difflib but are semantically
       identical. Strip all whitespace + punctuation and lowercase; if
       both sides match, it's noise.

    2. Token-permutation noise from DOM-ordering drift — scrapers
       sometimes concatenate adjacent button + link text in different
       orders across runs (`OKManage preferences` vs
       `Manage preferencesOK`). Same character multiset, short hunk.
       Cap at _PERMUTATION_MAX_CHARS so real long-form rewrites that
       happen to share letters are never dropped.

    Pure additions or pure deletions are never phantoms — something
    really was added or removed.
    """
    removed = "".join(dl.content for dl in hunk.lines if dl.type == "removed")
    added = "".join(dl.content for dl in hunk.lines if dl.type == "added")

    if not removed or not added:
        return False

    r_norm = _phantom_normalize(removed)
    a_norm = _phantom_normalize(added)

    if r_norm == a_norm:
        return True

    if len(r_norm) <= _PERMUTATION_MAX_CHARS and sorted(r_norm) == sorted(a_norm):
        return True

    return False


def _parse_unified_diff(raw_lines: list[str]) -> list[DiffHunk]:
    """Parse raw unified diff output into DiffHunk objects."""
    hunks: list[DiffHunk] = []
    current_hunk: DiffHunk | None = None
    old_line = 0
    new_line = 0

    for line in raw_lines:
        # Skip file headers
        if line.startswith("---") or line.startswith("+++"):
            continue

        # Hunk header
        if line.startswith("@@"):
            current_hunk = _parse_hunk_header(line)
            if current_hunk is not None:
                hunks.append(current_hunk)
                old_line = current_hunk.old_start
                new_line = current_hunk.new_start
            continue

        if current_hunk is None:
            continue

        content = line.rstrip("\n")

        if line.startswith("+"):
            current_hunk.lines.append(
                DiffLine(
                    type="added",
                    content=content[1:],
                    new_line_number=new_line,
                )
            )
            new_line += 1
        elif line.startswith("-"):
            current_hunk.lines.append(
                DiffLine(
                    type="removed",
                    content=content[1:],
                    old_line_number=old_line,
                )
            )
            old_line += 1
        else:
            current_hunk.lines.append(
                DiffLine(
                    type="context",
                    content=content[1:] if content.startswith(" ") else content,
                    old_line_number=old_line,
                    new_line_number=new_line,
                )
            )
            old_line += 1
            new_line += 1

    return hunks


def _parse_hunk_header(line: str) -> DiffHunk | None:
    """Parse '@@ -a,b +c,d @@' into a DiffHunk shell."""
    import re

    match = re.match(
        r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@",
        line,
    )
    if match is None:
        return None
    return DiffHunk(
        old_start=int(match.group(1)),
        old_count=int(match.group(2) or 1),
        new_start=int(match.group(3)),
        new_count=int(match.group(4) or 1),
    )


def _type_to_prefix(
    line_type: Literal["added", "removed", "unchanged", "context"],
) -> str:
    """Map line type to unified diff prefix character."""
    if line_type == "added":
        return "+"
    if line_type == "removed":
        return "-"
    return " "
