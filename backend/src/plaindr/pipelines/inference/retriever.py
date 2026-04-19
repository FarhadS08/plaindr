"""Context-window RAG retriever — deterministic file selection
and direct Anthropic answer generation."""

import json
import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache

import anthropic

from plaindr.clients.policy_store import PolicyStore
from plaindr.config import Settings

logger = logging.getLogger(__name__)

_ANSWER_MODEL = "claude-sonnet-4-20250514"
_VOICE_MODEL = "claude-haiku-4-5-20251001"
_VOICE_MAX_SOURCES = 4
_VOICE_MAX_TOKENS = 400
# Hard cap on policies sent to the text LLM to stay under Anthropic's
# per-minute input token limits (30K TPM on default tier).
_TEXT_MAX_SOURCES = 8

_SUBJECTIVE_RE = re.compile(
    r"\b(best|worst|safest|most ethical|most secure|better|worse"
    r"|recommend|recommendation)\b"
    r"|\bwhich .* should i\b",
    re.IGNORECASE,
)


@lru_cache(maxsize=4)
def _anthropic_client(api_key: str) -> anthropic.Anthropic:
    """Cached Anthropic client — avoids TLS setup on every request."""
    return anthropic.Anthropic(api_key=api_key)


@dataclass
class RetrievalResult:
    """A policy source used in the answer."""

    text: str
    source_url: str
    section_heading: str
    policy_summary: str
    company_name: str
    relevance_score: float = 1.0


@dataclass
class RAGResponse:
    """Complete RAG response with answer and sources."""

    answer: str
    sources: list[RetrievalResult]
    intent: str
    confidence: str = "high"
    avg_relevance_score: float = 0.0


def _is_subjective(question: str) -> bool:
    """Detect subjective questions that require value judgments."""
    return _SUBJECTIVE_RE.search(question) is not None


def query(
    question: str,
    settings: Settings,
    store: PolicyStore,
    company_filter: str | None = None,
    policy_type_filter: str | None = None,
) -> RAGResponse:
    """Context-window RAG: select policies, load full text, ask Claude.

    Single API call replaces the old 5-stage pipeline
    (classify → embed → search → rerank → answer).
    """
    # Hard refuse subjective questions before hitting the LLM
    if _is_subjective(question):
        return RAGResponse(
            answer=(
                "That requires a subjective judgment I cannot make. "
                "I can only report what policies state factually. "
                "Try asking about specific policy provisions — for example, "
                "'What data does X collect?' or 'What are X's retention periods?'"
            ),
            sources=[],
            intent="subjective_refused",
            confidence="high",
        )

    policies = store.select_policies(question, company_filter, policy_type_filter)
    intent = _infer_intent(policies, company_filter)

    if not policies:
        return RAGResponse(
            answer="I couldn't find relevant policy information "
            "to answer that question.",
            sources=[],
            intent=intent,
            confidence="none",
        )

    # Cap to stay under Anthropic's per-minute input token limit. For
    # multi-company comparisons (e.g. "ChatGPT vs Claude"), retrieval
    # may return 50+ docs; sending them all would exceed 30K TPM.
    policies = policies[:_TEXT_MAX_SOURCES]
    sources = _policies_to_sources(policies)
    confidence = "high" if len(policies) <= 5 else "medium"
    prompt = _build_prompt(question, policies, confidence)
    try:
        answer = _generate_answer(prompt, settings)
    except anthropic.RateLimitError:
        logger.warning("Anthropic rate limit hit for query")
        return RAGResponse(
            answer=(
                "The AI service is temporarily rate-limited. "
                "Please wait a few seconds and try again, or ask a "
                "more specific question about a single company."
            ),
            sources=sources,
            intent=intent,
            confidence="none",
        )
    except anthropic.APIError as exc:
        logger.exception("Anthropic API error for query")
        return RAGResponse(
            answer=(
                f"Couldn't reach the AI service right now "
                f"({exc.__class__.__name__}). Please try again."
            ),
            sources=sources,
            intent=intent,
            confidence="none",
        )

    return RAGResponse(
        answer=answer,
        sources=sources,
        intent=intent,
        confidence=confidence,
        avg_relevance_score=1.0,
    )


def query_stream(
    question: str,
    settings: Settings,
    store: PolicyStore,
    company_filter: str | None = None,
    policy_type_filter: str | None = None,
) -> Iterator[str]:
    """Streaming context-window RAG.

    Yields SSE-formatted events matching the old interface:
      - data: {"type":"sources",...}
      - data: {"type":"token","text":"..."}
      - data: {"type":"done"}
    """
    policies = store.select_policies(question, company_filter, policy_type_filter)
    # Cap to stay under Anthropic's per-minute input token limit.
    policies = policies[:_TEXT_MAX_SOURCES]
    intent = _infer_intent(policies, company_filter)
    sources = _policies_to_sources(policies)
    confidence = "high" if len(policies) <= 5 else "medium"

    sources_event = json.dumps({
        "type": "sources",
        "intent": intent,
        "sources": [
            {
                "text": s.text[:200],
                "source_url": s.source_url,
                "section_heading": s.section_heading,
                "company_name": s.company_name,
                "relevance_score": s.relevance_score,
            }
            for s in sources
        ],
        "confidence": confidence,
        "avg_relevance_score": 1.0,
    })
    yield f"data: {sources_event}\n\n"

    if not policies:
        no_results = (
            "I couldn't find relevant policy information to answer that question."
        )
        yield f"data: {json.dumps({'type': 'token', 'text': no_results})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return

    prompt = _build_prompt(question, policies, confidence)
    for token in _stream_answer(prompt, settings):
        yield f"data: {json.dumps({'type': 'token', 'text': token})}\n\n"

    yield f"data: {json.dumps({'type': 'done'})}\n\n"


# ── Voice-optimized query ─────────────────────────────


def query_voice(
    question: str,
    settings: Settings,
    store: PolicyStore,
    company_filter: str | None = None,
    policy_type_filter: str | None = None,
) -> RAGResponse:
    """Low-latency RAG tuned for conversational voice.

    Differences from query():
      - Uses Haiku (2-3x faster than Sonnet)
      - Caps sources at 4 (less context = faster TTFT)
      - Short answer cap (400 tokens ~= 15s of speech)
      - Spoken-style prompt (no markdown, no brackets)
    """
    if _is_subjective(question):
        return RAGResponse(
            answer=(
                "That's a subjective question I can't answer. "
                "I can only tell you what the policies actually say. "
                "Try asking something specific, like what data a company collects."
            ),
            sources=[],
            intent="subjective_refused",
            confidence="high",
        )

    policies = store.select_policies(
        question, company_filter, policy_type_filter
    )
    policies = policies[:_VOICE_MAX_SOURCES]
    intent = _infer_intent(policies, company_filter)
    sources = _policies_to_sources(policies)

    if not policies:
        return RAGResponse(
            answer=(
                "I don't have that policy information in my knowledge base. "
                "Try asking about a different company."
            ),
            sources=[],
            intent=intent,
            confidence="none",
        )

    prompt = _build_voice_prompt(question, policies)
    answer = _generate_answer(
        prompt,
        settings,
        model=_VOICE_MODEL,
        max_tokens=_VOICE_MAX_TOKENS,
    )
    return RAGResponse(
        answer=answer,
        sources=sources,
        intent=intent,
        confidence="high",
        avg_relevance_score=1.0,
    )


def query_voice_stream(
    question: str,
    settings: Settings,
    store: PolicyStore,
    company_filter: str | None = None,
    policy_type_filter: str | None = None,
) -> Iterator[str]:
    """Streaming voice query — yields raw text chunks (not SSE)."""
    if _is_subjective(question):
        yield (
            "That's a subjective question I can't answer. "
            "I can only tell you what the policies state."
        )
        return

    policies = store.select_policies(
        question, company_filter, policy_type_filter
    )
    policies = policies[:_VOICE_MAX_SOURCES]

    if not policies:
        yield (
            "I don't have that policy information in my knowledge base."
        )
        return

    prompt = _build_voice_prompt(question, policies)
    yield from _stream_answer(
        prompt,
        settings,
        model=_VOICE_MODEL,
        max_tokens=_VOICE_MAX_TOKENS,
    )


def _build_voice_prompt(question: str, policies) -> str:
    """Build a prompt optimized for spoken responses.

    No markdown, no [Source N] brackets read aloud, short and direct.
    """
    context_parts = []
    for i, policy in enumerate(policies, 1):
        company = policy.title.split()[0] if policy.title else ""
        context_parts.append(
            f"Document {i} ({company}, {policy.policy_type}):\n"
            f"{policy.content}"
        )
    context = "\n\n---\n\n".join(context_parts)

    return (
        "You are answering a user over voice. Keep responses to 2-3 short "
        "sentences, conversational tone, no markdown, no bullet points, "
        "no [Source N] citations (you can mention company name naturally). "
        "If the answer isn't in the documents, say so plainly in one "
        "sentence.\n\n"
        f"Question: {question}\n\n"
        f"Documents:\n{context}"
    )


# ── Internal Helpers ───────────────────────────────────


def _infer_intent(policies, company_filter: str | None) -> str:
    """Infer query intent from selected policies."""
    if not policies:
        return "general"
    company_ids = {p.author_id for p in policies}
    if company_filter or len(company_ids) == 1:
        return "single_company"
    if len(company_ids) == 2:
        return "comparison"
    return "general"


def _policies_to_sources(policies) -> list[RetrievalResult]:
    """Convert PolicyDocuments to RetrievalResult.

    Keeps full content so downstream consumers (eval judge, UI) can
    verify claims against the actual document text.
    """
    return [
        RetrievalResult(
            text=p.content,
            source_url=str(p.source_url),
            section_heading=p.title,
            policy_summary=p.summary or "",
            company_name=p.title.split()[0] if p.title else "",
            relevance_score=1.0,
        )
        for p in policies
    ]


def _build_prompt(question: str, policies, confidence: str) -> str:
    """Build prompt with full policy documents as context."""
    context_parts = []
    for i, policy in enumerate(policies, 1):
        summary_line = f"Summary: {policy.summary}\n" if policy.summary else ""
        context_parts.append(
            f"[Source {i}] {policy.source_url} — {policy.title}\n"
            f"{summary_line}"
            f"Content:\n{policy.content}\n"
        )
    context = "\n---\n".join(context_parts)

    confidence_warning = ""
    if confidence == "low":
        confidence_warning = (
            "\n⚠️ LIMITED POLICY DATA. If you cannot answer with high "
            "certainty from these documents alone, clearly state that the "
            "available information is insufficient.\n\n"
        )

    return (
        f"Question: {question}\n"
        f"{confidence_warning}"
        f"\nPolicy documents:\n\n{context}"
    )


_ANSWER_SYSTEM = """\
You are Plaindr, an AI policy analyst for AI tool policies.

STRICT RULES — these are non-negotiable for policy compliance:
1. Answer ONLY from the provided policy documents. NEVER use outside knowledge,
   training data, or general knowledge about the company — even if you think
   you know the answer. If it's not in the documents below, you don't know it.
2. Cite every claim using [Source N] notation — uncited statements are forbidden.
3. NEVER invent section numbers, headings, clause numbers, or subtitles.
   If you quote, the quoted text must appear VERBATIM in the provided document.
   When in doubt, paraphrase with a citation rather than quote.
4. If the documents do NOT contain enough information to fully answer,
   explicitly state what is missing. NEVER guess, infer, or fill gaps.
5. If NONE of the documents are relevant, say EXACTLY:
   "The available policy information does not address this question."
6. If the user asks about a policy type (privacy, terms, security) that is
   NOT in the provided documents for the requested company, say EXPLICITLY:
   "I don't have [policy type] for [company] in my knowledge base."
   Do NOT suggest where to find it externally. Do NOT give URLs.
7. Distinguish between what a policy explicitly states vs. what it
   does not mention — absence of a restriction is NOT the same as permission.
8. Keep answers concise but thorough. Paraphrase policy language when
   possible; only quote verbatim when the exact wording matters.
9. Never apologize for missing information — just state it factually.
10. REFUSE subjective questions (which is "best", "safest", "most ethical",
    recommendations). Respond: "That requires a subjective judgment I cannot
    make. I can only report what the policies state factually."
11. If asked about information not typically in privacy/terms/security docs
    (pricing, company details, personnel, revenue), say: "That information
    is not typically included in policy documents and is not available here."
"""


def _cached_system() -> list[dict]:
    """System prompt formatted for Anthropic prompt caching.

    The system prompt is stable across requests, so we mark it as a
    cache-control block. Cached content is 90% cheaper and much faster
    on subsequent requests within the 5-minute TTL window.
    """
    return [
        {
            "type": "text",
            "text": _ANSWER_SYSTEM,
            "cache_control": {"type": "ephemeral"},
        }
    ]


def _generate_answer(
    prompt: str,
    settings: Settings,
    *,
    model: str = _ANSWER_MODEL,
    max_tokens: int = 2048,
) -> str:
    """Generate an answer using Anthropic Claude with prompt caching."""
    client = _anthropic_client(
        settings.anthropic_api_key.get_secret_value()
    )
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=_cached_system(),
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


def _stream_answer(
    prompt: str,
    settings: Settings,
    *,
    model: str = _ANSWER_MODEL,
    max_tokens: int = 2048,
) -> Iterator[str]:
    """Stream answer tokens using Anthropic Claude with prompt caching."""
    client = _anthropic_client(
        settings.anthropic_api_key.get_secret_value()
    )
    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        system=_cached_system(),
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        yield from stream.text_stream
