"""Service-role Supabase client for row-level operations.

Separate from :mod:`plaindr.clients.storage` (which handles file I/O)
because table operations need their own narrow seam — callers should
not get arbitrary access to the raw supabase-py client, only the
specific row operations they need.

All methods here run with the service role key. The caller is
responsible for authorization (checking the JWT, verifying
ownership/membership) before invoking these methods.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from supabase import create_client

from plaindr.config import Settings

logger = logging.getLogger(__name__)


class SupabaseTableClient:
    """Narrow facade over a service-role Supabase client.

    Only the methods we actually need are exposed — we never hand out
    the underlying client, so callers cannot accidentally bypass the
    ownership checks the router layer enforces.
    """

    def __init__(self, settings: Settings) -> None:
        self._client = create_client(
            settings.supabase_url,
            settings.supabase_service_key.get_secret_value(),
        )

    # ── organization membership (read-only) ─────────────────────

    def is_org_member(self, user_id: str, organization_id: str) -> bool:
        """Check whether ``user_id`` belongs to ``organization_id``.

        Used by the submission endpoint before accepting an
        organization-scoped submission. Service-role read bypasses
        RLS — the caller is responsible for supplying a validated
        user_id (from the JWT).
        """
        try:
            res = (
                self._client.table("organization_members")
                .select("user_id")
                .eq("organization_id", organization_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
        except Exception:
            logger.exception(
                "Membership check failed for user=%s org=%s",
                user_id,
                organization_id,
            )
            return False
        return bool(res.data)

    # ── user_policies ───────────────────────────────────────────

    def list_user_policies(
        self,
        user_id: str | None,
        organization_id: str | None,
    ) -> list[dict[str, Any]]:
        """Return rows visible to the given scope.

        At least one of ``user_id`` / ``organization_id`` must be
        non-None. Returned rows are raw dicts — the router layer
        reshapes them for the API response.
        """
        if user_id is None and organization_id is None:
            return []

        q = self._client.table("user_policies").select("*")
        if organization_id is not None:
            q = q.eq("organization_id", organization_id)
        else:
            # Personal rows only — exclude rows that belong to any org.
            q = q.eq("user_id", user_id).is_("organization_id", "null")
        try:
            res = q.order("created_at", desc=True).execute()
        except Exception:
            logger.exception(
                "list_user_policies failed user=%s org=%s",
                user_id,
                organization_id,
            )
            return []
        return list(res.data or [])

    def get_user_policy_by_id(self, policy_id: str) -> dict[str, Any] | None:
        """Fetch a single row by primary key, or None."""
        try:
            res = (
                self._client.table("user_policies")
                .select("*")
                .eq("id", policy_id)
                .limit(1)
                .execute()
            )
        except Exception:
            logger.exception("get_user_policy_by_id failed id=%s", policy_id)
            return None
        rows = res.data or []
        return rows[0] if rows else None

    def upsert_user_policy(
        self,
        *,
        user_id: str | None,
        organization_id: str | None,
        url: str,
        title: str | None,
        content_hash: str | None,
        storage_path: str,
        is_canonical_mirror: bool,
        last_status: str,
        last_scraped_at: datetime | None,
    ) -> dict[str, Any]:
        """Insert or update a user_policies row.

        Keyed by (user_id, url) or (organization_id, url) depending on
        scope — matches the partial-unique indexes in migration 011.
        Returns the resulting row.
        """
        if (user_id is None) == (organization_id is None):
            raise ValueError(
                "upsert_user_policy requires exactly one of "
                "user_id/organization_id"
            )

        payload: dict[str, Any] = {
            "url": url,
            "title": title,
            "content_hash": content_hash,
            "storage_path": storage_path,
            "is_canonical_mirror": is_canonical_mirror,
            "last_status": last_status,
            "last_scraped_at": (
                last_scraped_at.isoformat() if last_scraped_at else None
            ),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        if user_id is not None:
            payload["user_id"] = user_id
            payload["organization_id"] = None
            on_conflict = "user_id,url"
        else:
            payload["organization_id"] = organization_id
            payload["user_id"] = None
            on_conflict = "organization_id,url"

        res = (
            self._client.table("user_policies")
            .upsert(payload, on_conflict=on_conflict)
            .execute()
        )
        rows = res.data or []
        if not rows:
            raise RuntimeError(
                f"Upsert returned no row for url={url!r}"
            )
        return rows[0]

    def delete_user_policy(self, policy_id: str) -> None:
        """Delete a row by ID."""
        self._client.table("user_policies").delete().eq(
            "id", policy_id
        ).execute()

    # ── weekly-cron helpers ─────────────────────────────────────
    # These are used by the rescrape pipeline. We intentionally skip
    # canonical mirrors here because the canonical loop already scraped
    # their URLs; re-scraping would double-bill Firecrawl.

    def list_rescrape_candidates(self) -> list[dict[str, Any]]:
        """Return every user_policies row that isn't a canonical mirror.

        The canonical loop in `run_rescrape` already covered mirror URLs
        via the companies.yaml path, so this restricts to truly
        user-private content. Ordered by staleness so older rows get
        updated first within a run.
        """
        try:
            res = (
                self._client.table("user_policies")
                .select("id, url, content_hash, storage_path, is_canonical_mirror")
                .eq("is_canonical_mirror", False)
                .order("last_scraped_at", desc=False, nullsfirst=True)
                .execute()
            )
        except Exception:
            logger.exception("list_rescrape_candidates failed")
            return []
        return list(res.data or [])

    def mark_user_policy_status(
        self, policy_id: str, status: str, *, error: str | None = None
    ) -> None:
        """Stamp `last_scraped_at` and `last_status` without touching content."""
        payload: dict[str, Any] = {
            "last_status": status,
            "last_scraped_at": datetime.now(UTC).isoformat(),
        }
        if error is not None:
            # Don't widen the schema for an error column we don't store;
            # log it instead.
            logger.warning("user_policy %s failed: %s", policy_id, error)
        try:
            self._client.table("user_policies").update(payload).eq(
                "id", policy_id
            ).execute()
        except Exception:
            logger.exception("mark_user_policy_status failed id=%s", policy_id)

    def update_user_policy_after_scrape(
        self,
        policy_id: str,
        *,
        content_hash: str,
        storage_path: str,
        status: str,
    ) -> None:
        """Update a row after a successful scrape that produced new content."""
        payload = {
            "content_hash": content_hash,
            "storage_path": storage_path,
            "last_status": status,
            "last_scraped_at": datetime.now(UTC).isoformat(),
        }
        try:
            self._client.table("user_policies").update(payload).eq(
                "id", policy_id
            ).execute()
        except Exception:
            logger.exception(
                "update_user_policy_after_scrape failed id=%s", policy_id
            )

    def user_policy_count_recent(self, user_id: str, hours: int) -> int:
        """Count rows submitted by ``user_id`` in the last ``hours``.

        Used to enforce the daily (24h) submission cap. The hourly cap
        lives in the in-memory SlidingWindowLimiter; we need a DB query
        for the daily one because it survives process restarts.
        """
        cutoff = datetime.now(UTC) - timedelta(hours=hours)
        try:
            res = (
                self._client.table("user_policies")
                .select("id", count="exact")
                .eq("user_id", user_id)
                .gte("created_at", cutoff.isoformat())
                .execute()
            )
        except Exception:
            logger.exception(
                "user_policy_count_recent failed user=%s hours=%d",
                user_id,
                hours,
            )
            return 0
        return int(res.count or 0)

    # ── auth helper (read-only) ─────────────────────────────────

    def verify_jwt(self, token: str) -> str | None:
        """Verify a Supabase access token and return the ``user_id``.

        Returns None on any failure — the router converts that to 401.
        We wrap ``auth.get_user`` so the router never touches the raw
        supabase-py error types.
        """
        try:
            res = self._client.auth.get_user(token)
        except Exception:
            logger.debug("JWT verification failed", exc_info=True)
            return None
        user = getattr(res, "user", None)
        if user is None:
            return None
        return getattr(user, "id", None)
