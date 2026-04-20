"""Voice router — ElevenLabs Conversational AI tool-call endpoint.

ElevenLabs agents call this endpoint when they need RAG-grounded answers
about AI policies. The agent sends the user's transcribed question and
receives a structured answer with source citations.

Flow:
  User speaks -> ElevenLabs STT -> Agent calls /api/voice/tool-call
    -> RAG -> answer + sources -> Agent TTS -> User hears answer
"""

import hashlib
import hmac
import json
import logging
import threading
import time
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from plaindr.api.dependencies import get_policy_store, get_settings
from plaindr.clients.policy_store import PolicyStore
from plaindr.config import Settings
from plaindr.pipelines.inference.retriever import (
    query_voice,
    query_voice_stream,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["voice"])


# -- Request / Response Models ────────────────────────


class ToolCallInput(BaseModel):
    """Payload the ElevenLabs agent sends when invoking the RAG tool."""

    question: str = Field(..., max_length=2000, min_length=1)
    company_filter: str | None = Field(None, max_length=100)


class ToolCallSource(BaseModel):
    company: str
    policy_type: str
    source_url: str
    section: str
    relevance: float


class ToolCallResponse(BaseModel):
    """Structured response the ElevenLabs agent uses to formulate speech."""

    answer: str
    sources: list[ToolCallSource]
    intent: str


# -- Rate Limiting (in-memory, per-process) ───────────
#
# Sliding-window limiter per caller IP. Thread-safe via lock.
# For multi-worker or multi-process deployments, replace with a
# Redis-backed limiter (this is a best-effort per-process fallback).

_RATE_WINDOW = 60.0
_RATE_LIMIT = 30
_rate_log: dict[str, deque[float]] = {}
_rate_lock = threading.Lock()


def _check_rate_limit(client_key: str) -> None:
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW
    with _rate_lock:
        bucket = _rate_log.setdefault(client_key, deque())
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= _RATE_LIMIT:
            raise HTTPException(
                status_code=429, detail="Rate limit exceeded"
            )
        bucket.append(now)


def _client_key(request: Request) -> str:
    """Derive a rate-limit key from the request."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# -- Auth Verification ────────────────────────────────


def _verify_elevenlabs_signature(
    body: bytes,
    signature: str | None,
    settings: Settings,
) -> None:
    """Verify request originates from ElevenLabs via HMAC signature.

    Production: set ELEVENLABS_WEBHOOK_SECRET. Requests without a valid
    matching signature are rejected with 401.

    Development: if the secret is empty AND DEBUG mode is enabled, the
    check is skipped. Otherwise (empty secret in prod) we fail closed.
    """
    secret = settings.elevenlabs_webhook_secret.get_secret_value()
    if not secret:
        if settings.debug:
            return
        raise HTTPException(
            status_code=503,
            detail="Voice endpoint not configured (missing webhook secret)",
        )
    if not signature:
        raise HTTPException(
            status_code=401, detail="Missing signature header"
        )
    expected = hmac.new(
        secret.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")


async def _authenticated_input(
    request: Request, settings: Settings
) -> ToolCallInput:
    """Read raw body, verify HMAC, then parse into ToolCallInput."""
    body = await request.body()
    signature = request.headers.get("elevenlabs-signature") or request.headers.get(
        "x-elevenlabs-signature"
    )
    _verify_elevenlabs_signature(body, signature, settings)
    try:
        data = json.loads(body) if body else {}
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400, detail="Invalid JSON body"
        ) from e
    return ToolCallInput.model_validate(data)


# -- Endpoints ────────────────────────────────────────


@router.post("/tool-call", response_model=ToolCallResponse)
async def handle_tool_call(
    request: Request,
    settings: Settings = Depends(get_settings),
    store: PolicyStore = Depends(get_policy_store),
) -> ToolCallResponse:
    """Voice RAG endpoint — HMAC-authenticated, rate-limited, low-latency.

    Uses Haiku + 4-source cap + prompt caching for ~800ms TTFT.
    """
    _check_rate_limit(_client_key(request))
    payload = await _authenticated_input(request, settings)

    # Per-call timing so anomalies (slow corpus selections, Haiku
    # outages) are visible in the logs. Caller IP is included so we
    # can spot abuse patterns without standing up a metrics pipeline.
    start = time.monotonic()
    result = query_voice(
        question=payload.question,
        settings=settings,
        store=store,
        company_filter=payload.company_filter,
    )
    elapsed_ms = int((time.monotonic() - start) * 1000)
    logger.info(
        "voice.tool_call caller=%s intent=%s sources=%d latency_ms=%d q=%r",
        _client_key(request),
        result.intent,
        len(result.sources),
        elapsed_ms,
        payload.question[:80],
    )

    sources = [
        ToolCallSource(
            company=s.company_name,
            policy_type="",
            source_url=s.source_url,
            section=s.section_heading,
            relevance=s.relevance_score,
        )
        for s in result.sources
    ]

    return ToolCallResponse(
        answer=result.answer,
        sources=sources,
        intent=result.intent,
    )


@router.post("/tool-call/stream")
async def handle_tool_call_stream(
    request: Request,
    settings: Settings = Depends(get_settings),
    store: PolicyStore = Depends(get_policy_store),
) -> StreamingResponse:
    """Streaming variant — yields text as Claude generates.

    ElevenLabs can start speaking the first tokens within ~800ms
    instead of waiting 3-5s for the full response.
    """
    _check_rate_limit(_client_key(request))
    payload = await _authenticated_input(request, settings)

    logger.info("Voice stream tool-call: %s", payload.question[:100])

    def _gen():
        yield from query_voice_stream(
            question=payload.question,
            settings=settings,
            store=store,
            company_filter=payload.company_filter,
        )

    return StreamingResponse(_gen(), media_type="text/plain")


@router.get("/health")
def voice_health() -> dict:
    """Health check for the voice integration."""
    return {"status": "ok", "service": "plaindr-voice"}
