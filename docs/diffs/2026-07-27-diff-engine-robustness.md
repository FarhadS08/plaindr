# Diff engine robustness — meaning-based change detection

**Date:** 2026-07-27
**Branch:** `fix/diff-engine-robustness`
**Problem:** Policy change detection keyed on MD5 of scraped content, so cosmetic drift between scrapes — a comma, an extra space, a dot, a markdown emphasis toggle — surfaced to users as a "change" even when nothing semantic changed.

## What existed before

The phantom-diff defenses were real but **incomplete**:

1. **`clean_markdown`** (refiner.py) normalizes a lot of scraper drift before hashing.
2. **Canonical path only** (`_upsert_and_sync`, orchestrator.py) ran three guards: raw MD5 → `semantic_hash` → phantom-hunk filter.

Gaps that still let phantoms through:

- **`semantic_hash` stripped markdown + whitespace but not punctuation**, so a lone comma produced a different hash. On the canonical path the per-hunk filter usually masked this; elsewhere it leaked. It also had **zero tests**.
- **The phantom-hunk filter was per-hunk and structural.** Pure additions/deletions are never phantom by design, so drift that difflib aligned as an unpaired add (e.g. a stray `---` line) or split across two hunks (a comma moved between paragraphs) slipped through as "real."
- **The user-submitted-policy rescrape path (`_rescrape_user_policies`) had none of the guards** — it compared raw MD5 only, so any cosmetic drift on a user's submitted URL was reported as "updated."

## What changed

**One canonical meaning signature, used everywhere** (`utils/hashing.py`):
`normalize_for_meaning(text)` lowercases, strips HTML tags, then drops every non-alphanumeric character (punctuation, whitespace, markdown). Letters and digits survive, so real wording/number changes are preserved but cosmetic drift collapses:

- `"data, sharing"` and `"data sharing"` → identical
- `"$1,000"` and `"$1000"` → identical (thousands separator is cosmetic)
- `"30 days"` vs `"90 days"` → **different** (real change preserved)

`semantic_hash` is now the MD5 of this signature, so it catches punctuation drift too. The differ's per-hunk normalizer now delegates to the same function (one source of truth).

**Document-level guard in `compute_diff`** (differ.py): before per-hunk work, if the two versions share the same meaning signature, return no hunks. This is strictly stronger than per-hunk filtering — it can't be fooled by unpaired adds/deletes or cross-hunk drift.

**User-policy rescrape now checks meaning** (orchestrator.py `_rescrape_user_policies`): on a byte-level mismatch it downloads the stored copy and compares meaning signatures; only a genuine meaning change is marked "updated." If the stored copy can't be read, it fails safe to "changed" (never silently hides a real update). Canonicalized bytes + hash are written back so the next run's cheap MD5 check matches.

## Tests (24 new)

- `test_hashing.py`: `normalize_for_meaning` + `semantic_hash` — comma/space/dot/markdown/HTML/thousands-separator collapse; numeric and word changes preserved; empty/punctuation-only inputs.
- `test_differ.py::TestDocumentLevelMeaningGuard`: cross-hunk punctuation drift, pure-addition punctuation line, underscore-emphasis toggle, whole-document reformat → all dropped; real numeric/word changes survive.
- `test_rescrape_meaning_guard.py`: cosmetic drift → "unchanged"; real change → "updated" (+ bytes written back); identical bytes → fast path; unreadable old copy → fail-safe "changed".

Full backend suite: 338 passed, ruff clean.

## Deferred (item 5) — optional semantic confirmation

The gate is intentionally **deterministic** (no LLM in the change/no-change decision — it must be cheap and reproducible across ~130 policies). True meaning-level equivalence beyond punctuation/formatting — reordered clauses, synonym swaps ("may" ↔ "is permitted to") — would need embeddings or an LLM judge. Recommended design if pursued: invoke it **only** when the deterministic layer says "changed" but the change is small (few tokens moved), as a final materiality gate, cached and rate-limited. This keeps the common path deterministic and cost bounded. Not implemented here.
