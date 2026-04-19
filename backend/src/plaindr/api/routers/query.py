"""Query router — RAG query endpoint + SSE streaming variant."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from plaindr.api.dependencies import get_policy_store, get_settings
from plaindr.api.rate_limit import SlidingWindowLimiter, client_key
from plaindr.clients.policy_store import PolicyStore
from plaindr.config import Settings
from plaindr.pipelines.inference.retriever import (
    query as rag_query,
)
from plaindr.pipelines.inference.retriever import (
    query_stream as rag_query_stream,
)

router = APIRouter(prefix="/query", tags=["query"])

# 20 queries per minute per IP on both endpoints
_limiter = SlidingWindowLimiter(limit=20, window_seconds=60.0)


class QueryRequest(BaseModel):
    question: str = Field(..., max_length=2000, min_length=1)
    company_filter: str | None = Field(None, max_length=100)
    policy_type_filter: str | None = Field(None, max_length=50)


class SourceItem(BaseModel):
    text: str
    source_url: str
    section_heading: str
    policy_summary: str
    relevance_score: float
    company_name: str = ""


class QueryResponse(BaseModel):
    answer: str
    sources: list[SourceItem]
    intent: str


@router.post("", response_model=QueryResponse)
def run_query(
    request: QueryRequest,
    http: Request,
    settings: Settings = Depends(get_settings),
    store: PolicyStore = Depends(get_policy_store),
):
    """Context-window RAG query: select → load full docs → generate."""
    _limiter.check(client_key(http))
    result = rag_query(
        question=request.question,
        settings=settings,
        store=store,
        company_filter=request.company_filter,
        policy_type_filter=request.policy_type_filter,
    )
    sources = [
        SourceItem(
            text=s.text[:2000],
            source_url=s.source_url,
            section_heading=s.section_heading,
            policy_summary=s.policy_summary,
            relevance_score=s.relevance_score,
            company_name=s.company_name or "",
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
    event_stream = rag_query_stream(
        question=request.question,
        settings=settings,
        store=store,
        company_filter=request.company_filter,
        policy_type_filter=request.policy_type_filter,
    )
    return StreamingResponse(
        event_stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
