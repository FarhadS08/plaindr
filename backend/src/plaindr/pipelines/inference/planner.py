"""LLM-backed retrieval planner.

Deterministic keyword scoring on titles and summaries collapses to a
near-tie for most open-ended questions — every ToS has "terms" in its
title, so "which policy is more suitable for Germany" ranks them all
equally and returns an arbitrary top-N. This planner replaces that
path with a Haiku call that sees a compact index of the entire corpus
(one line per policy: company, type, title, short summary) and
returns the source_urls most relevant to the question.

The index is stable across queries, so it ships as a cached system
block — subsequent queries within the 5-minute TTL pay ~10% of the
input cost.
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache

import anthropic

from plaindr.clients.policy_store import PolicyStore
from plaindr.config import Settings
from plaindr.models.policy import PolicyDocument

logger = logging.getLogger(__name__)

_PLANNER_MODEL = "claude-haiku-4-5-20251001"
_PLANNER_MAX_TOKENS = 512
_SUMMARY_CHARS = 220
_DEFAULT_MAX_SOURCES = 8


def plan_policies(
    question: str,
    store: PolicyStore,
    settings: Settings,
    policy_type_filter: str | None = None,
    max_sources: int = _DEFAULT_MAX_SOURCES,
) -> list[PolicyDocument]:
    """Ask Haiku to pick the most relevant policies for a general query.

    Returns up to ``max_sources`` PolicyDocuments, ordered by the model's
    own ranking. Returns ``[]`` if the planner can't find anything
    relevant or the call fails.
    """
    candidates = _candidate_pool(store, policy_type_filter)
    if not candidates:
        return []

    index_block = _format_index(candidates)
    try:
        urls = _ask_planner(question, index_block, settings, max_sources)
    except anthropic.APIError:
        logger.exception("Planner call failed — returning empty selection")
        return []

    by_url = {str(p.source_url): p for p in candidates}
    picked: list[PolicyDocument] = []
    seen: set[str] = set()
    for url in urls:
        policy = by_url.get(url)
        if policy is None or url in seen:
            continue
        picked.append(policy)
        seen.add(url)
        if len(picked) >= max_sources:
            break
    return picked


def _candidate_pool(
    store: PolicyStore, policy_type_filter: str | None
) -> list[PolicyDocument]:
    """Return the subset of policies the planner is allowed to pick from."""
    pool = store.list_policies()
    if policy_type_filter:
        typed = [p for p in pool if p.policy_type == policy_type_filter]
        return typed or pool
    return pool


def _format_index(policies: list[PolicyDocument]) -> str:
    """Build the compact corpus index the planner reasons over.

    One line per policy, in a stable order so prompt-caching hits:
        <source_url> | <company_id> | <policy_type> | <title> | <summary>
    """
    lines = []
    for policy in sorted(policies, key=lambda p: str(p.source_url)):
        summary = (policy.summary or "").strip().replace("\n", " ")
        if len(summary) > _SUMMARY_CHARS:
            summary = summary[: _SUMMARY_CHARS - 1].rstrip() + "…"
        lines.append(
            f"{policy.source_url} | {policy.author_id} | "
            f"{policy.policy_type} | {policy.title} | {summary}"
        )
    return "\n".join(lines)


@lru_cache(maxsize=4)
def _anthropic_client(api_key: str) -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=api_key)


_PLANNER_SYSTEM = """\
You triage policy-document retrieval for Plaindr. The user asks a
question about AI-company policies; you see an index of every policy
in the corpus (one per line) and pick the ones whose full text most
likely contains the answer.

Each index line is:
    <source_url> | <company_id> | <policy_type> | <title> | <summary>

# How to choose

- Prefer policies whose title or summary directly addresses the
  question's topic. When the question names a jurisdiction (Germany,
  EU, California…) or a regulation (GDPR, CCPA), pick policies whose
  summaries mention those markers or imply coverage (EEA customers,
  Irish law, European entity, data residency, international transfer).
- For comparison questions, pick 2–3 policies per relevant company so
  the answer can quote real text from each side.
- Diversify across companies unless the question is clearly about one.
- Skip policies whose summary is obviously unrelated — do not fill a
  quota with weak matches. If truly nothing fits, return an empty list.
- Never invent source_urls. Only return URLs that appear verbatim in
  the index.

# Output

Return ONLY a JSON object, no prose, no code fences:
    {"source_urls": ["https://…", "https://…"]}

Order the list best-first. Hard cap: the number requested.
"""


def _planner_system(index_block: str, max_sources: int) -> list[dict]:
    """System prompt with the corpus index marked for prompt caching."""
    return [
        {"type": "text", "text": _PLANNER_SYSTEM},
        {
            "type": "text",
            "text": f"# Corpus index ({max_sources} max picks)\n\n{index_block}",
            "cache_control": {"type": "ephemeral"},
        },
    ]


def _ask_planner(
    question: str,
    index_block: str,
    settings: Settings,
    max_sources: int,
) -> list[str]:
    """Send the planner prompt and parse source_urls out of the response."""
    client = _anthropic_client(settings.anthropic_api_key.get_secret_value())
    response = client.messages.create(
        model=_PLANNER_MODEL,
        max_tokens=_PLANNER_MAX_TOKENS,
        system=_planner_system(index_block, max_sources),
        messages=[
            {
                "role": "user",
                "content": (
                    f"Question: {question}\n\n"
                    f"Return up to {max_sources} source_urls."
                ),
            }
        ],
    )
    text = response.content[0].text if response.content else ""
    return _parse_source_urls(text)


_JSON_BLOCK_RE = re.compile(r"\{[^{}]*\"source_urls\"[^{}]*\}", re.DOTALL)


def _parse_source_urls(text: str) -> list[str]:
    """Extract the ``source_urls`` list from the planner's response.

    Haiku is instructed to return bare JSON, but we defend against
    stray prose or code fences by locating the first JSON object with
    a ``source_urls`` key.
    """
    if not text:
        return []
    match = _JSON_BLOCK_RE.search(text)
    payload = match.group(0) if match else text
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        logger.warning("Planner returned non-JSON output: %s", text[:200])
        return []
    urls = data.get("source_urls") if isinstance(data, dict) else None
    if not isinstance(urls, list):
        return []
    return [u for u in urls if isinstance(u, str) and u.startswith("http")]
