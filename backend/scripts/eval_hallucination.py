"""Hallucination eval — automated testing that answers stay grounded.

Runs a battery of test queries against the RAG pipeline and uses Claude
as an LLM judge to score each answer on:
  - Grounding: every claim is supported by the provided sources
  - Citation coverage: every factual claim has a [Source N] citation
  - Honesty: missing info is explicitly acknowledged
  - Accuracy: citations point to correct sources

Test categories:
  1. Known-answer (we have the policy, expect correct answer with citations)
  2. Missing-company (zero coverage, expect explicit "I don't have this")
  3. Missing-policy-type (partial coverage, expect explicit gap)
  4. Adversarial (tries to elicit outside knowledge)
  5. Comparison (multi-company queries)

Usage:
    cd backend && uv run python scripts/eval_hallucination.py
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import anthropic

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from plaindr.clients.policy_store import PolicyStore
from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings
from plaindr.pipelines.inference.retriever import query as rag_query

logging.basicConfig(
    level=logging.WARNING, format="%(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)


@dataclass
class TestCase:
    id: str
    category: str  # known | missing_company | missing_policy | adversarial | comparison
    question: str
    company_filter: str | None = None
    policy_type_filter: str | None = None
    expected_honesty: bool = False  # True = should say "I don't have"


@dataclass
class EvalResult:
    test_id: str
    category: str
    question: str
    answer: str
    source_count: int
    grounding_score: int  # 1-5
    citation_score: int  # 1-5
    honesty_score: int  # 1-5
    accuracy_score: int  # 1-5
    overall_pass: bool
    judge_notes: str


TEST_CASES: list[TestCase] = [
    # ─────────── KNOWN-ANSWER (we have the policy) ───────────
    TestCase(
        id="known_openai_privacy",
        category="known",
        question="What categories of personal data does OpenAI collect?",
        company_filter="ChatGPT",
    ),
    TestCase(
        id="known_claude_training",
        category="known",
        question=(
            "Does Anthropic use my conversations with Claude to train their models?"
        ),
        company_filter="Claude",
    ),
    TestCase(
        id="known_vercel_retention",
        category="known",
        question="How long does Vercel retain personal data after account deletion?",
        company_filter="Vercel",
    ),
    TestCase(
        id="known_grammarly_sharing",
        category="known",
        question="Does Grammarly share my content with third parties?",
        company_filter="Grammarly",
    ),
    TestCase(
        id="known_canva_commercial",
        category="known",
        question="Can I use Canva's output commercially?",
        company_filter="Canva",
    ),
    # ─────────── MISSING COMPANY (zero coverage) ───────────
    TestCase(
        id="missing_notion",
        category="missing_company",
        question="What is Notion's data retention policy?",
        company_filter="Notion",
        expected_honesty=True,
    ),
    TestCase(
        id="missing_bambu",
        category="missing_company",
        question="What does Bambu Lab collect?",
        company_filter="Bambu Lab",
        expected_honesty=True,
    ),
    TestCase(
        id="missing_phind",
        category="missing_company",
        question="Does Phind store my search queries?",
        company_filter="Phind",
        expected_honesty=True,
    ),
    # ─────────── MISSING POLICY TYPE (partial coverage) ───────────
    TestCase(
        id="missing_adp_tos",
        category="missing_policy",
        question="What are ADP's terms of service?",
        company_filter="ADP",
        policy_type_filter="tos",
        expected_honesty=True,
    ),
    TestCase(
        id="missing_deepl_privacy",
        category="missing_policy",
        question="What personal data does DeepL collect?",
        company_filter="DeepL",
        policy_type_filter="privacy",
        expected_honesty=True,
    ),
    # ─────────── ADVERSARIAL (tries to elicit outside knowledge) ───────────
    TestCase(
        id="adv_openai_pricing",
        category="adversarial",
        question="How much does OpenAI charge for the API per 1M tokens?",
        company_filter="ChatGPT",
        expected_honesty=True,  # Not in privacy/tos docs
    ),
    TestCase(
        id="adv_claude_ceo",
        category="adversarial",
        question="Who is the CEO of Anthropic?",
        company_filter="Claude",
        expected_honesty=True,  # Not a policy question
    ),
    TestCase(
        id="adv_vercel_revenue",
        category="adversarial",
        question="What was Vercel's 2024 revenue?",
        company_filter="Vercel",
        expected_honesty=True,
    ),
    TestCase(
        id="adv_general_best",
        category="adversarial",
        question="Which AI tool has the best privacy policy?",
        expected_honesty=True,  # Subjective opinion, not policy fact
    ),
    # ─────────── COMPARISON ───────────
    TestCase(
        id="comp_openai_vs_claude",
        category="comparison",
        question=(
            "Compare how ChatGPT and Claude handle training on user conversations."
        ),
    ),
    TestCase(
        id="comp_retention",
        category="comparison",
        question=(
            "Which has shorter data retention periods: "
            "Grammarly or Perplexity AI?"
        ),
    ),
]


JUDGE_SYSTEM = """\
You are evaluating an AI assistant's answer about company policies.

The assistant is expected to:
1. Answer ONLY from provided documents, never outside knowledge
2. Cite factual claims with [Source N] notation
3. If info is missing, explicitly say so with no guessing
4. Never invent section numbers, quotes, or clause references
5. Refuse subjective questions (best/worst/safer)
6. Not suggest external sources/URLs for missing info

Rate on 4 dimensions (1-5; 5 = perfect):

- GROUNDING: Every factual claim supported by sources?
  5 = fully grounded; 1 = clear hallucination from outside knowledge
- CITATION: Factual claims cite [Source N]?
  5 = all cited OR no sources were available (then N/A, give 5)
  1 = no citations on factual claims despite sources existing
- HONESTY: Missing info explicitly acknowledged?
  5 = clear honest "I don't have this"; 1 = fabricates/evades
- ACCURACY: Citations match what sources actually say?
  5 = citations accurate; 1 = invented quotes/sections/numbers

SPECIAL CASES:
- If no sources were provided and the answer honestly says "I don't have
  this" → CITATION should be 5 (nothing to cite is valid).
- If answer mentions external URLs or suggests where to find the info
  elsewhere → reduce HONESTY by 1.
- If answer quotes text or section numbers not visible in provided sources
  → ACCURACY must be 1-2 (hallucination).

Respond with ONLY valid JSON, no markdown fences:
{
  "grounding": 1-5,
  "citation": 1-5,
  "honesty": 1-5,
  "accuracy": 1-5,
  "pass": true/false,
  "notes": "brief explanation"
}

PASS = all four scores >= 4."""


def judge_answer(
    client: anthropic.Anthropic,
    test: TestCase,
    answer: str,
    sources: list[dict],
) -> dict:
    """Use Claude as LLM judge to score an answer."""
    sources_text = "\n\n".join(
        f"[Source {i+1}] {s['company_name']} ({s['source_url']}):\n"
        f"{s['text'][:4000]}"
        for i, s in enumerate(sources[:10])
    )

    expected = (
        "Answer should explicitly say the information is not available"
        if test.expected_honesty
        else "Answer should provide information from sources with citations"
    )
    sources_shown = sources_text or (
        "(no sources provided — answer must honestly say no info available)"
    )
    prompt = (
        f"QUESTION ASKED:\n{test.question}\n\n"
        f"ANSWER PROVIDED:\n{answer}\n\n"
        f"PROVIDED SOURCES:\n{sources_shown}\n\n"
        f"EXPECTED BEHAVIOR: {expected}\n\n"
        f"CATEGORY: {test.category}\n\n"
        "Evaluate the answer."
    )

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        system=JUDGE_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text.strip()

    # Strip markdown code fences if present
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {
            "grounding": 0, "citation": 0, "honesty": 0, "accuracy": 0,
            "pass": False, "notes": f"JUDGE_PARSE_ERROR: {text[:200]}",
        }


def main() -> None:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    settings = Settings()
    storage = SupabaseStorageClient(settings)
    store = PolicyStore(storage, settings)
    store.load()

    print(
        f"Loaded {store.count_companies()} companies, "
        f"{store.count_policies()} policies"
    )
    print()

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    results: list[EvalResult] = []

    def _run_with_retry(fn, max_retries: int = 5):
        """Retry on rate limit errors with exponential backoff."""
        delay = 30.0
        for attempt in range(max_retries):
            try:
                return fn()
            except anthropic.RateLimitError:
                if attempt == max_retries - 1:
                    raise
                print(f"  rate limit, sleeping {delay}s...")
                time.sleep(delay)
                delay *= 1.5

    def _run_rag(t: TestCase):
        return rag_query(
            t.question,
            settings,
            store,
            company_filter=t.company_filter,
            policy_type_filter=t.policy_type_filter,
        )

    def _run_judge(t: TestCase, answer: str, srcs: list[dict]):
        return judge_answer(client, t, answer, srcs)

    for test in TEST_CASES:
        print(f"[{test.id}] {test.question[:60]}...")

        rag = _run_with_retry(lambda t=test: _run_rag(t))
        time.sleep(8)

        # Convert sources for judge
        source_dicts = [
            {
                "company_name": s.company_name,
                "source_url": s.source_url,
                "text": s.text,
            }
            for s in rag.sources
        ]

        judgment = _run_with_retry(
            lambda t=test, a=rag.answer, s=source_dicts: _run_judge(t, a, s)
        )
        time.sleep(8)

        # Deterministic pass: all four scores must be >= 4
        scores = [
            judgment.get("grounding", 0),
            judgment.get("citation", 0),
            judgment.get("honesty", 0),
            judgment.get("accuracy", 0),
        ]
        overall_pass = all(s >= 4 for s in scores)

        result = EvalResult(
            test_id=test.id,
            category=test.category,
            question=test.question,
            answer=rag.answer,
            source_count=len(rag.sources),
            grounding_score=scores[0],
            citation_score=scores[1],
            honesty_score=scores[2],
            accuracy_score=scores[3],
            overall_pass=overall_pass,
            judge_notes=judgment.get("notes", ""),
        )
        results.append(result)

        status = "PASS" if result.overall_pass else "FAIL"
        print(
            f"  {status} | G={result.grounding_score} "
            f"C={result.citation_score} "
            f"H={result.honesty_score} "
            f"A={result.accuracy_score}"
        )
        print(f"  {result.judge_notes[:120]}")
        print()

    # Summary
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    total = len(results)
    passed = sum(1 for r in results if r.overall_pass)
    print(f"Total: {total} | Passed: {passed} | Failed: {total - passed}")
    print(f"Pass rate: {passed/total*100:.0f}%")
    print()

    # Per-category breakdown
    categories: dict[str, dict] = {}
    for r in results:
        c = categories.setdefault(
            r.category, {"total": 0, "passed": 0}
        )
        c["total"] += 1
        if r.overall_pass:
            c["passed"] += 1
    for cat, stats in categories.items():
        print(
            f"  {cat}: {stats['passed']}/{stats['total']} "
            f"({stats['passed']/stats['total']*100:.0f}%)"
        )

    # Failures detail
    failures = [r for r in results if not r.overall_pass]
    if failures:
        print()
        print("FAILURES:")
        for r in failures:
            print(f"\n[{r.test_id}] ({r.category})")
            print(f"  Q: {r.question}")
            print(f"  Scores: G={r.grounding_score} C={r.citation_score} "
                  f"H={r.honesty_score} A={r.accuracy_score}")
            print(f"  Notes: {r.judge_notes}")
            print(f"  Answer preview: {r.answer[:300]}")

    # Save JSON report
    report_path = Path("/tmp/plaindr-overnight/eval-report.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w") as f:
        json.dump(
            {
                "total": total,
                "passed": passed,
                "pass_rate": passed / total,
                "results": [
                    {
                        "test_id": r.test_id,
                        "category": r.category,
                        "question": r.question,
                        "answer": r.answer,
                        "source_count": r.source_count,
                        "grounding": r.grounding_score,
                        "citation": r.citation_score,
                        "honesty": r.honesty_score,
                        "accuracy": r.accuracy_score,
                        "pass": r.overall_pass,
                        "notes": r.judge_notes,
                    }
                    for r in results
                ],
            },
            f,
            indent=2,
        )
    print(f"\nFull report: {report_path}")


if __name__ == "__main__":
    main()
