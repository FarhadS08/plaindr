"""User-submitted policies router.

Flow (see /api/user-policies/submit):
    1. JWT-authed — caller is a known Supabase user.
    2. Rate-limited (5/hour in-memory + 10/day via DB count).
    3. Optional org scope — caller must be a member.
    4. Scrape via the shared 3-tier cascade (single_scrape.py).
    5. If the URL matches a canonical policy:
         - same content hash → mirror (no duplicate storage)
         - different hash + flag → full canonical update
         - different hash + flag off → degraded mirror
    6. Otherwise → private upload to user_policies bucket.

The JWT is verified against Supabase's own auth server — we don't roll
our own token format. The service-role client is only used AFTER the
JWT has resolved the caller's user_id.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from plaindr.api.dependencies import (
    get_policy_store,
    get_settings,
    get_storage_client,
)
from plaindr.api.rate_limit import SlidingWindowLimiter
from plaindr.clients.policy_store import PolicyStore
from plaindr.clients.storage import SupabaseStorageClient
from plaindr.clients.supabase_table import SupabaseTableClient
from plaindr.config import Settings
from plaindr.pipelines.feature.single_scrape import scrape_single_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/user-policies", tags=["user-policies"])

# In-memory hourly limiter. The daily (24h) cap is enforced via a DB
# count so it survives process restarts — 5 submissions inside an hour
# is rare enough that a process-local limiter is fine for the upper
# bound, but surviving a restart matters for the daily cap where the
# attack surface is larger.
_HOURLY_LIMIT = 5
_DAILY_LIMIT = 10
_hourly_limiter = SlidingWindowLimiter(
    limit=_HOURLY_LIMIT, window_seconds=3600.0
)

# URL validation: reject anything that isn't http/https or is absurdly
# long. Firecrawl will reject nonsense URLs too, but failing fast here
# keeps the scrape budget for legitimate submissions.
_MAX_URL_LENGTH = 2048


# ── Dependencies ────────────────────────────────────────────


def _get_table_client(
    settings: Settings = Depends(get_settings),
) -> SupabaseTableClient:
    # Built per-request so Settings changes in tests propagate — the
    # underlying supabase-py client is cheap to construct.
    return SupabaseTableClient(settings)


def _require_user(
    authorization: str | None = Header(default=None),
    table: SupabaseTableClient = Depends(_get_table_client),
) -> str:
    """Resolve the caller's user_id from ``Authorization: Bearer ...``.

    Raises 401 when the header is missing or the token is rejected
    by Supabase. We return the user id as a plain string — that's
    what the JWT carries and what the ``user_policies.user_id``
    column stores (Clerk IDs are strings; Supabase auth ids are UUIDs
    but we keep the column as text so both shapes fit).
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401, detail="Missing Bearer token"
        )
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=401, detail="Empty Bearer token"
        )
    user_id = table.verify_jwt(token)
    if not user_id:
        raise HTTPException(
            status_code=401, detail="Invalid or expired token"
        )
    return user_id


def _require_feature_enabled(
    settings: Settings = Depends(get_settings),
) -> None:
    """Guard every endpoint behind the feature flag.

    Ships the router dark until ``USER_POLICIES_ENABLED=true`` is set
    in the runtime env. Returns 404 (not 503) on purpose — the endpoint
    should look like it doesn't exist to unauthenticated probes.
    """
    if not settings.user_policies_enabled:
        raise HTTPException(status_code=404, detail="Not found")


# ── Request / Response models ───────────────────────────────


class SubmitRequest(BaseModel):
    url: str = Field(min_length=1, max_length=_MAX_URL_LENGTH)
    organization_id: str | None = None


class SubmitResponse(BaseModel):
    id: str
    mode: str  # canonical_unchanged | canonical_updated | private_new
    markdown: str
    diff_text: str | None = None
    last_scraped_at: str
    degraded: bool = False


class UserPolicyListItem(BaseModel):
    id: str
    url: str
    title: str | None
    last_scraped_at: str | None
    last_status: str
    is_canonical_mirror: bool


class MarkdownResponse(BaseModel):
    markdown: str
    url: str
    last_scraped_at: str | None


# ── Helpers ─────────────────────────────────────────────────


def _validate_url(url: str) -> str:
    """Strict URL validation for submission input.

    Keep this conservative — we hand the URL directly to the scraper,
    which hits Firecrawl/Playwright, which hits arbitrary hosts. We
    don't want to accept ``file://`` or ``javascript:`` URIs.
    """
    try:
        parsed = urlparse(url.strip())
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid URL: {exc}"
        ) from exc
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=400,
            detail="URL must use http or https",
        )
    if not parsed.netloc:
        raise HTTPException(
            status_code=400, detail="URL must include a host"
        )
    return url.strip()


def _slugify(text: str) -> str:
    """Filesystem-safe slug for the user-policy filename."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "policy"


def _user_policy_filename(url: str, content_hash: str) -> str:
    """Deterministic filename including a hash suffix.

    The hash suffix prevents collisions when two submissions for the
    same owner share a URL path (e.g. ``/privacy`` from different hosts)
    and keeps the filename stable across re-submissions with identical
    content.
    """
    parsed = urlparse(url)
    host_slug = _slugify(parsed.netloc.removeprefix("www."))
    path_slug = _slugify(parsed.path) if parsed.path else "root"
    suffix = content_hash[:8]
    return f"{host_slug}-{path_slug}-{suffix}.md"


def _row_visible_to_caller(
    row: dict[str, Any],
    caller_user_id: str,
    table: SupabaseTableClient,
) -> bool:
    """Ownership / membership check for a user_policies row.

    Service-role bypasses RLS, so the router enforces scope manually:
    either the caller owns the row, or they're a member of its org.
    """
    if row.get("user_id") == caller_user_id:
        return True
    org_id = row.get("organization_id")
    if org_id and table.is_org_member(caller_user_id, str(org_id)):
        return True
    return False


# ── Endpoints ───────────────────────────────────────────────


@router.post(
    "/submit",
    response_model=SubmitResponse,
    dependencies=[Depends(_require_feature_enabled)],
)
def submit_policy(
    body: SubmitRequest,
    user_id: str = Depends(_require_user),
    settings: Settings = Depends(get_settings),
    table: SupabaseTableClient = Depends(_get_table_client),
    storage: SupabaseStorageClient = Depends(get_storage_client),
    store: PolicyStore = Depends(get_policy_store),
) -> SubmitResponse:
    """Submit a URL, scrape it, and upsert a user_policies row."""
    url = _validate_url(body.url)

    # 1. Rate limiting
    _hourly_limiter.check(f"user:{user_id}")
    if table.user_policy_count_recent(user_id, hours=24) >= _DAILY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Daily submission limit of {_DAILY_LIMIT} reached",
        )

    # 2. Organization scope check
    organization_id: str | None = None
    if body.organization_id:
        if not table.is_org_member(user_id, body.organization_id):
            raise HTTPException(
                status_code=403,
                detail="Not a member of this organization",
            )
        organization_id = body.organization_id

    # 3. Scrape
    result = scrape_single_url(url, settings)
    if result.error or result.markdown is None or result.content_hash is None:
        raise HTTPException(
            status_code=502,
            detail=f"Scrape failed: {result.error or 'unknown error'}",
        )

    # 4. Branch on canonical match
    canonical = store.find_canonical_by_url(url)
    now = datetime.now(UTC)
    degraded = False
    diff_text: str | None = None

    if canonical is not None and canonical.id == result.content_hash:
        mode = "canonical_unchanged"
        storage_path = ""
        is_mirror = True
        markdown_out = canonical.content
        title = canonical.title
    elif canonical is not None and canonical.id != result.content_hash:
        if settings.user_policies_can_update_canonical:
            mode, diff_text = _run_canonical_update(
                canonical, result, settings, storage, store
            )
            storage_path = ""
            is_mirror = True
            markdown_out = result.markdown
            title = result.title or canonical.title
        else:
            # Flag off — treat as an unchanged mirror so the user still
            # sees canonical content. Caller gets `degraded=true` so
            # the UI can say "content drift detected but your
            # permissions don't allow updating the canonical version."
            degraded = True
            mode = "canonical_unchanged"
            storage_path = ""
            is_mirror = True
            markdown_out = canonical.content
            title = canonical.title
    else:
        mode = "private_new"
        owner_id = organization_id or user_id
        filename = _user_policy_filename(url, result.content_hash)
        storage_path = f"{owner_id}/{filename}"
        try:
            storage.upload_user_policy(owner_id, filename, result.markdown)
        except Exception as exc:
            logger.exception("Failed to upload user policy to storage")
            raise HTTPException(
                status_code=500,
                detail=f"Storage upload failed: {exc}",
            ) from exc
        is_mirror = False
        markdown_out = result.markdown
        title = result.title

    # 5. Upsert the row
    row = table.upsert_user_policy(
        user_id=user_id if organization_id is None else None,
        organization_id=organization_id,
        url=url,
        title=title,
        content_hash=result.content_hash,
        storage_path=storage_path,
        is_canonical_mirror=is_mirror,
        last_status=mode,
        last_scraped_at=now,
    )

    return SubmitResponse(
        id=str(row["id"]),
        mode=mode,
        markdown=markdown_out,
        diff_text=diff_text,
        last_scraped_at=now.isoformat(),
        degraded=degraded,
    )


@router.get(
    "",
    response_model=list[UserPolicyListItem],
    dependencies=[Depends(_require_feature_enabled)],
)
def list_my_policies(
    organization_id: str | None = None,
    user_id_filter: str | None = None,
    user_id: str = Depends(_require_user),
    table: SupabaseTableClient = Depends(_get_table_client),
) -> list[UserPolicyListItem]:
    """List rows visible to the caller.

    Scope precedence: if ``organization_id`` is passed, caller must be a
    member and gets that org's rows. Otherwise we return the caller's
    own personal rows. ``user_id_filter`` is ignored when the caller
    isn't the same user — scoping bugs here leak private data, so we
    err strictly on the side of "return nothing unexpected."
    """
    if organization_id:
        if not table.is_org_member(user_id, organization_id):
            raise HTTPException(
                status_code=403,
                detail="Not a member of this organization",
            )
        rows = table.list_user_policies(
            user_id=None, organization_id=organization_id
        )
    else:
        target_user = user_id_filter if user_id_filter == user_id else user_id
        rows = table.list_user_policies(
            user_id=target_user, organization_id=None
        )

    items: list[UserPolicyListItem] = []
    for row in rows:
        items.append(UserPolicyListItem(
            id=str(row["id"]),
            url=row["url"],
            title=row.get("title"),
            last_scraped_at=row.get("last_scraped_at"),
            last_status=row.get("last_status", "unknown"),
            is_canonical_mirror=bool(row.get("is_canonical_mirror")),
        ))
    return items


@router.get(
    "/{policy_id}/markdown",
    response_model=MarkdownResponse,
    dependencies=[Depends(_require_feature_enabled)],
)
def get_markdown(
    policy_id: str,
    user_id: str = Depends(_require_user),
    table: SupabaseTableClient = Depends(_get_table_client),
    storage: SupabaseStorageClient = Depends(get_storage_client),
    store: PolicyStore = Depends(get_policy_store),
) -> MarkdownResponse:
    """Download markdown for a user_policies row.

    Canonical mirrors pull from the canonical bucket (the single
    source of truth); private rows pull from the user-policies
    bucket at the exact path stored on the row.
    """
    row = table.get_user_policy_by_id(policy_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    if not _row_visible_to_caller(row, user_id, table):
        raise HTTPException(status_code=404, detail="Not found")

    markdown: str
    if row.get("is_canonical_mirror"):
        canonical = store.find_canonical_by_url(row["url"])
        if canonical is None:
            # Canonical row disappeared between submission and read —
            # surface as 404 so the UI refreshes the list.
            raise HTTPException(
                status_code=404,
                detail="Canonical policy no longer available",
            )
        markdown = canonical.content
    else:
        try:
            markdown = storage.download_user_policy(row["storage_path"])
        except Exception as exc:
            logger.exception("Failed to download user policy markdown")
            raise HTTPException(
                status_code=500,
                detail=f"Storage download failed: {exc}",
            ) from exc

    return MarkdownResponse(
        markdown=markdown,
        url=row["url"],
        last_scraped_at=row.get("last_scraped_at"),
    )


@router.delete(
    "/{policy_id}",
    dependencies=[Depends(_require_feature_enabled)],
)
def delete_policy(
    policy_id: str,
    user_id: str = Depends(_require_user),
    table: SupabaseTableClient = Depends(_get_table_client),
    storage: SupabaseStorageClient = Depends(get_storage_client),
) -> dict[str, bool]:
    """Delete a user_policies row and its private storage object.

    Ownership is strict: only the row's owning user can delete.
    Org-scoped rows are not deletable via this endpoint — that's
    intentional, because "any member can delete the org's submissions"
    is a foot-gun we'll design separately with role checks.
    """
    row = table.get_user_policy_by_id(policy_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    if row.get("user_id") != user_id:
        raise HTTPException(
            status_code=403,
            detail="Only the owner can delete",
        )

    if not row.get("is_canonical_mirror") and row.get("storage_path"):
        try:
            storage.delete_user_policy(row["storage_path"])
        except Exception:
            # Swallow storage delete failures — the row delete is what
            # actually matters for the user. An orphaned object will be
            # cleaned up by a future sweeper; losing the DB row with a
            # lingering object is far less bad than the opposite.
            logger.warning(
                "Storage delete failed for %s — row will still be deleted",
                row["storage_path"],
            )

    table.delete_user_policy(policy_id)
    return {"ok": True}


# ── Canonical update path ───────────────────────────────────


def _run_canonical_update(
    canonical,  # PolicyDocument
    scrape_result,  # SingleScrapeResult
    settings: Settings,
    storage: SupabaseStorageClient,
    store: PolicyStore,
) -> tuple[str, str | None]:
    """Apply a user submission as a canonical version bump.

    Reuses the existing orchestrator helper that archives the old
    version, computes and uploads the diff, runs AI analysis, and
    registers the new document in the cache. Returns a tuple of
    (mode, diff_text).
    """
    from plaindr.models.policy import PolicyDocument
    from plaindr.pipelines.feature.orchestrator import (
        PipelineResult,
        _upsert_and_sync,
    )
    from plaindr.pipelines.inference.differ import (
        compute_diff,
        diff_to_unified_text,
    )

    # Build the new PolicyDocument from the scraped content,
    # carrying over everything the canonical row already knew about
    # the policy (company, type, URL) — a user's one-off submission
    # shouldn't be allowed to rewrite those.
    assert scrape_result.markdown is not None
    assert scrape_result.content_hash is not None

    new_doc = PolicyDocument(
        id=scrape_result.content_hash,
        author_id=canonical.author_id,
        title=canonical.title,
        policy_type=canonical.policy_type,
        source_url=canonical.source_url,
        content=scrape_result.markdown,
        version=canonical.version,  # _upsert_and_sync bumps this
        effective_date=canonical.effective_date,
        previous_version_id=canonical.id,
    )

    # Compute a diff text up front so we can return it to the caller
    # even if the downstream AI analysis fails.
    hunks = compute_diff(canonical.content, scrape_result.markdown)
    diff_text = diff_to_unified_text(hunks)

    dummy_result = PipelineResult()
    try:
        _upsert_and_sync(new_doc, settings, storage, store, dummy_result)
    except Exception:
        logger.exception(
            "Canonical update via user submission failed for %s",
            canonical.source_url,
        )
        # Fall back to an unchanged mirror so the submitter at least
        # gets the existing canonical content — not blocking them on
        # a storage/LLM outage is more important than the version bump.
        return "canonical_unchanged", None

    return "canonical_updated", diff_text
