"""Store admin router — reload and status endpoints.

All endpoints require an admin token passed via X-Admin-Token header,
matching the ADMIN_TOKEN env var. Without the env var set, the endpoints
return 503 (not configured) rather than running unauthenticated.
"""

import hmac
import logging
import threading

from fastapi import APIRouter, Depends, Header, HTTPException

from plaindr.api.dependencies import get_policy_store, get_settings
from plaindr.clients.policy_store import PolicyStore
from plaindr.config import Settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/store", tags=["store"])

# Serialize reloads so two concurrent requests can't race the cache clear
_reload_lock = threading.Lock()


def _require_admin(
    x_admin_token: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """Constant-time comparison against the configured admin token."""
    if not settings.admin_token:
        raise HTTPException(
            status_code=503, detail="Admin endpoints not configured"
        )
    if not x_admin_token:
        raise HTTPException(
            status_code=401, detail="Missing X-Admin-Token header"
        )
    if not hmac.compare_digest(x_admin_token, settings.admin_token):
        raise HTTPException(status_code=401, detail="Invalid admin token")


@router.post("/reload", dependencies=[Depends(_require_admin)])
def reload_store(
    store: PolicyStore = Depends(get_policy_store),
):
    """Clear and reload the in-memory PolicyStore from Supabase Storage.

    Serialized with a lock so concurrent reloads can't leave the cache
    in a partial state. Returns 409 if a reload is already in progress.
    """
    if not _reload_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409, detail="Reload already in progress"
        )
    try:
        logger.info("Admin reload starting")
        store.reload()
        logger.info(
            "Admin reload complete: %d policies, %d companies",
            store.count_policies(),
            store.count_companies(),
        )
    finally:
        _reload_lock.release()

    return {
        "status": "reloaded",
        "policies": store.count_policies(),
        "companies": store.count_companies(),
    }
