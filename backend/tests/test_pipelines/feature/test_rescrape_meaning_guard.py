"""Regression tests for the user-policy rescrape meaning guard.

The reported bug: a rescrape that produced only whitespace/punctuation drift
was marked "updated" because detection compared raw MD5. The rescrape path
now compares the *meaning* signature before declaring a change, mirroring the
canonical path's semantic-equivalence guard.
"""

from types import SimpleNamespace
from unittest.mock import patch

import plaindr.clients.supabase_table as supabase_table_mod
import plaindr.pipelines.feature.orchestrator as orch
from plaindr.pipelines.feature.orchestrator import (
    PipelineResult,
    _rescrape_user_policies,
)
from plaindr.utils.hashing import md5_hash


class _FakeTable:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows
        self.status: dict[str, str] = {}       # mark_user_policy_status
        self.updated: dict[str, tuple[str, str]] = {}  # id -> (hash, status)

    def list_rescrape_candidates(self) -> list[dict]:
        return self._rows

    def mark_user_policy_status(
        self, policy_id: str, status: str, *, error: str | None = None
    ) -> None:
        self.status[policy_id] = status

    def update_user_policy_after_scrape(
        self, policy_id: str, *, content_hash: str, storage_path: str, status: str
    ) -> None:
        self.updated[policy_id] = (content_hash, status)


class _FakeStorage:
    def __init__(self, files: dict[str, str]) -> None:
        self.files = dict(files)               # "owner/name" -> content

    def download_user_policy(self, path: str) -> str:
        return self.files[path]

    def upload_user_policy(self, owner: str, filename: str, content: str) -> None:
        self.files[f"{owner}/{filename}"] = content


def _run(
    rows: list[dict], files: dict[str, str], scrapes: dict[str, str]
) -> tuple[_FakeTable, _FakeStorage]:
    """Drive _rescrape_user_policies with fakes. `scrapes` maps url -> new markdown."""
    table = _FakeTable(rows)
    storage = _FakeStorage(files)

    def fake_scrape_task(scraper, task, agent=None):
        return SimpleNamespace(error=None, markdown=scrapes[task.policy_url])

    with (
        patch.object(
            supabase_table_mod, "SupabaseTableClient", lambda settings: table
        ),
        patch.object(orch, "scrape_task", fake_scrape_task),
        patch.object(orch, "clean_markdown", lambda md: md),
    ):
        _rescrape_user_policies(
            settings=None,
            scraper=object(),
            agent=None,
            storage=storage,
            store=None,
            result=PipelineResult(),
        )
    return table, storage


def _row(rid: str, url: str, old: str, path: str) -> dict:
    return {
        "id": rid,
        "url": url,
        "content_hash": md5_hash(old),
        "storage_path": path,
        "is_canonical_mirror": False,
    }


def test_cosmetic_drift_marked_unchanged():
    old = "Retention: 30 days."
    row = _row("row-cosmetic", "https://a.com/privacy", old, "owner-a/a.md")
    # Extra spaces + comma/period drift — different bytes, identical meaning.
    new_raw = "Retention:  30  days,"
    table, _ = _run([row], {"owner-a/a.md": old}, {"https://a.com/privacy": new_raw})

    # Bytes differ so it enters the meaning-guard path, but the status must be
    # "unchanged" — no phantom "updated" surfaced to the user.
    assert table.updated["row-cosmetic"] == (md5_hash(new_raw), "unchanged")


def test_real_change_marked_updated():
    old = "Retention: 30 days."
    row = _row("row-real", "https://b.com/privacy", old, "owner-b/b.md")
    new_raw = "Retention: 90 days."  # real numeric change
    table, storage = _run(
        [row], {"owner-b/b.md": old}, {"https://b.com/privacy": new_raw}
    )

    assert table.updated["row-real"] == (md5_hash(new_raw), "updated")
    # Canonicalized bytes written back so next week's cheap md5 check matches.
    assert storage.files["owner-b/b.md"] == new_raw


def test_identical_bytes_take_fast_unchanged_path():
    old = "Retention: 30 days."
    row = _row("row-same", "https://c.com/privacy", old, "owner-c/c.md")
    table, _ = _run([row], {"owner-c/c.md": old}, {"https://c.com/privacy": old})

    # md5 matches → fast path → status stamp only, never the update path.
    assert table.status["row-same"] == "unchanged"
    assert "row-same" not in table.updated


def test_unreadable_old_copy_falls_back_to_changed():
    old = "Retention: 30 days."
    row = _row("row-blind", "https://d.com/privacy", old, "owner-d/d.md")
    new_raw = "Retention:  30 days"  # cosmetic, but old copy is missing

    table = _FakeTable([row])

    class _BlindStorage(_FakeStorage):
        def download_user_policy(self, path: str) -> str:
            raise FileNotFoundError(path)

    storage = _BlindStorage({})

    def fake_scrape_task(scraper, task, agent=None):
        return SimpleNamespace(error=None, markdown=new_raw)

    with (
        patch.object(
            supabase_table_mod, "SupabaseTableClient", lambda settings: table
        ),
        patch.object(orch, "scrape_task", fake_scrape_task),
        patch.object(orch, "clean_markdown", lambda md: md),
    ):
        _rescrape_user_policies(
            settings=None,
            scraper=object(),
            agent=None,
            storage=storage,
            store=None,
            result=PipelineResult(),
        )

    # Can't verify meaning → fail safe to "updated" rather than hide a change.
    assert table.updated["row-blind"] == (md5_hash(new_raw), "updated")
