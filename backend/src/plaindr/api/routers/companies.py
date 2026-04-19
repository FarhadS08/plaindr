"""Companies router — company listing and detail."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from plaindr.api.dependencies import get_policy_store
from plaindr.clients.policy_store import PolicyStore

router = APIRouter(prefix="/companies", tags=["companies"])


@router.get("")
def list_companies(
    store: PolicyStore = Depends(get_policy_store),
):
    """List all tracked companies."""
    companies = store.list_companies()
    return [c.model_dump(mode="json") for c in companies]


@router.get("/{company_id}")
def get_company(
    company_id: UUID,
    store: PolicyStore = Depends(get_policy_store),
):
    """Company detail."""
    company = store.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return company.model_dump(mode="json")


@router.get("/{company_id}/policies")
def get_company_policies(
    company_id: UUID,
    store: PolicyStore = Depends(get_policy_store),
):
    """All policies for a company."""
    policies = store.get_policies_by_company(company_id)
    return [p.model_dump(mode="json") for p in policies]
