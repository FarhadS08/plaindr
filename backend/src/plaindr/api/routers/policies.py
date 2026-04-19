"""Policies router — CRUD + version history."""

from fastapi import APIRouter, Depends, HTTPException

from plaindr.api.dependencies import get_policy_store
from plaindr.clients.policy_store import PolicyStore

router = APIRouter(prefix="/policies", tags=["policies"])


@router.get("")
def list_policies(
    store: PolicyStore = Depends(get_policy_store),
):
    """List all current policies (metadata only, no content)."""
    docs = store.list_policies(exclude_content=True)
    return [d.model_dump(mode="json") for d in docs]


@router.get("/{source_url:path}")
def get_policy(
    source_url: str,
    store: PolicyStore = Depends(get_policy_store),
):
    """Get specific policy by source URL."""
    policy = store.get_policy_by_source_url(source_url)
    if policy is None:
        raise HTTPException(status_code=404, detail="Policy not found")
    return policy.model_dump(mode="json")


@router.get("/{source_url:path}/versions")
def get_versions(
    source_url: str,
    store: PolicyStore = Depends(get_policy_store),
):
    """Version history for a policy URL.

    Version history from archive bucket is future work — returns empty list.
    """
    return []


@router.get("/{source_url:path}/versions/{version}")
def get_version(
    source_url: str,
    version: int,
    store: PolicyStore = Depends(get_policy_store),
):
    """Specific archived version.

    Version retrieval from archive bucket is future work.
    """
    raise HTTPException(status_code=404, detail="Version not found")
