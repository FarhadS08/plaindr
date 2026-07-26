"""Query router — RAG query endpoint + SSE streaming variant."""

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from plaindr.api.dependencies import get_policy_store, get_settings
from plaindr.api.rate_limit import SlidingWindowLimiter, client_key
from plaindr.clients.policy_store import PolicyStore
from plaindr.clients.supabase_table import SupabaseTableClient
from plaindr.config import Settings
from plaindr.pipelines.inference.retriever import (
    query as rag_query,
)
from plaindr.pipelines.inference.retriever import (
    query_stream as rag_query_stream,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/query", tags=["query"])

# 20 queries per minute per IP on both endpoints
_limiter = SlidingWindowLimiter(limit=20, window_seconds=60.0)


class QueryRequest(BaseModel):
    question: str = Field(..., max_length=2000, min_length=1)
    company_filter: str | None = Field(None, max_length=100)
    policy_type_filter: str | None = Field(None, max_length=50)
    # Optional org scope. The caller's identity is NEVER taken from the
    # request body — user_id is derived from the verified Bearer token
    # (see `_optional_user`), and `organization_id` is honored only after
    # a server-side membership check (see `_resolve_scope`).
    organization_id: str | None = Field(None, max_length=64)


def _optional_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> str | None:
    """Resolve the caller's user_id from a Bearer token, if present.

    Unlike the user-policies router's ``_require_user`` this NEVER raises:
    the canonical corpus is public, so an anonymous query is valid and
    simply returns canonical-only results. A *valid* token unlocks the
    caller's private submissions; an absent or invalid token yields None.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        return SupabaseTableClient(settings).verify_jwt(token)
    except Exception:
        logger.debug("optional-auth token verification failed", exc_info=True)
        return None


def _resolve_scope(
    request: "QueryRequest",
    user_id: str | None,
    settings: Settings,
) -> tuple[str | None, str | None]:
    """Return the (user_id, organization_id) scope safe to pass downstream.

    Org scope requires an authenticated caller who is a member. Anything
    else raises rather than silently querying another tenant's data.
    """
    if not request.organization_id:
        return user_id, None
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Authentication required for organization-scoped queries",
        )
    if not SupabaseTableClient(settings).is_org_member(
        user_id, request.organization_id
    ):
        raise HTTPException(
            status_code=403, detail="Not a member of this organization"
        )
    return user_id, request.organization_id


class SourceItem(BaseModel):
    text: str
    source_url: str
    section_heading: str
    policy_summary: str
    relevance_score: float
    company_name: str = ""
    # Origin of this source — "canonical" for the curated corpus,
    # "user_submission" / "org_submission" for private uploads. The
    # frontend uses this to badge user-submitted citations.
    source_kind: str = "canonical"


class QueryResponse(BaseModel):
    answer: str
    sources: list[SourceItem]
    intent: str


@router.post("", response_model=QueryResponse)
def run_query(
    request: QueryRequest,
    http: Request,
    user_id: str | None = Depends(_optional_user),
    settings: Settings = Depends(get_settings),
    store: PolicyStore = Depends(get_policy_store),
):
    """Context-window RAG query: select → load full docs → generate."""
    _limiter.check(client_key(http))
    scoped_user_id, scoped_org_id = _resolve_scope(request, user_id, settings)
    result = rag_query(
        question=request.question,
        settings=settings,
        store=store,
        company_filter=request.company_filter,
        policy_type_filter=request.policy_type_filter,
        user_id=scoped_user_id,
        organization_id=scoped_org_id,
    )
    sources = [
        SourceItem(
            text=s.text[:2000],
            source_url=s.source_url,
            section_heading=s.section_heading,
            policy_summary=s.policy_summary,
            relevance_score=s.relevance_score,
            company_name=s.company_name or "",
            source_kind=s.source_kind,
        )
        for s in result.sources
    ]
    return QueryResponse(
        answer=result.answer,
        sources=sources,
        intent=result.intent,
    )


@router.post("/stream")
def run_query_stream(
    request: QueryRequest,
    http: Request,
    user_id: str | None = Depends(_optional_user),
    settings: Settings = Depends(get_settings),
    store: PolicyStore = Depends(get_policy_store),
) -> StreamingResponse:
    """Streaming RAG query via Server-Sent Events.

    Events:
      data: {"type":"sources","intent":"...","sources":[...]}
      data: {"type":"token","text":"..."}   (repeated)
      data: {"type":"done"}
    """
    _limiter.check(client_key(http))
    scoped_user_id, scoped_org_id = _resolve_scope(request, user_id, settings)
    event_stream = rag_query_stream(
        question=request.question,
        settings=settings,
        store=store,
        company_filter=request.company_filter,
        policy_type_filter=request.policy_type_filter,
        user_id=scoped_user_id,
        organization_id=scoped_org_id,
    )
    return StreamingResponse(
        event_stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
