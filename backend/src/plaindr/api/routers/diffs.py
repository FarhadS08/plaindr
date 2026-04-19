"""Diffs router — policy change retrieval."""

from fastapi import APIRouter, Depends, HTTPException

from plaindr.api.dependencies import get_policy_store
from plaindr.clients.policy_store import PolicyStore

router = APIRouter(prefix="/diffs", tags=["diffs"])


@router.get("/recent")
def get_recent_diffs(
    limit: int = 20,
    store: PolicyStore = Depends(get_policy_store),
):
    """Recent diffs across all policies (dashboard view)."""
    diffs = store.get_recent_diffs(limit=limit)
    return [d.model_dump(mode="json") for d in diffs]


@router.get("/by-url/{source_url:path}")
def get_diffs_by_url(
    source_url: str,
    store: PolicyStore = Depends(get_policy_store),
):
    """All diffs for a specific policy URL."""
    diffs = store.get_diffs_by_source_url(source_url)
    return [d.model_dump(mode="json") for d in diffs]


@router.get("/{diff_id}")
def get_diff(
    diff_id: str,
    store: PolicyStore = Depends(get_policy_store),
):
    """Specific diff with AI analysis."""
    diff = store.get_diff(diff_id)
    if diff is None:
        raise HTTPException(status_code=404, detail="Diff not found")
    return diff.model_dump(mode="json")
