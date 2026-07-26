# Library: submit a company's main URL, crawler discovers the policies

**Date:** 2026-06-02
**Status:** Approved (design) — pending spec review

## Problem

Today the Library feature (`SubmitPolicyDialog` → `userPolicies.submit` →
`/api/user-policies/submit`) requires the user to paste the **exact policy
URL** (e.g. `https://openai.com/policies/privacy-policy`). Users rarely know
the exact URL, and a company usually has several policy pages (privacy, terms,
security, cookies…). We want the user to paste only the **company's main URL**
(e.g. `chatgpt.com`) and have our crawler discover the policy pages itself.

## Goal

User pastes a main URL → we crawl the domain and surface the discovered policy
pages → user confirms the company identity and picks which policies to add →
we scrape the selected pages with a cinematic progress experience → each
discovered policy is **promoted into the shared canonical corpus** (visible to
all users, tracked weekly) and linked from the submitting user's Library.

## Decisions (from brainstorming)

1. **Two-step flow:** discover (fast) → user picks → ingest (streamed). Not
   auto-add-everything; the user selects which discovered policies to add.
2. **Promote to the shared canonical corpus.** A newly discovered policy that
   we don't already track joins the global corpus — it appears in the sidebar
   company list for everyone, gets weekly change detection, and is searchable
   by all users. The submitting user's Library also links to it.
3. **New-company identity:** match the domain against existing companies first;
   if none, auto-infer `{name, category}` (LLM) and show it **pre-filled and
   editable** in the review step. User has final say.
4. **Progress mechanism:** SSE streaming (reuses the `/api/query/stream`
   pattern), presented as a **cinematic** animated scene — not a bare
   "scraping 2/5" — so the wait feels intentional.

## Architecture

Two endpoints + a 3-state dialog. No new routes.

```
Submit dialog (input)  ──POST /api/user-policies/discover──►  Review step (pick)
                                                                     │
                                              POST /api/user-policies/ingest-stream (SSE)
                                                                     ▼
                                                          Cinematic progress → Done
```

Reused primitives: `firecrawl.map_policy_urls`, `_infer_policy_type`
(`url_discovery.py`), the canonical scrape → `clean_markdown` →
`validate_content` → store pipeline, the diff pipeline, and the SSE response
pattern + client SSE parser already used by `streamQuery`.

The legacy exact-policy-URL submit path is **replaced** by this flow. The
backend's single-URL scrape function is retained — both discover and ingest
call it per URL.

## Component 1 — `POST /api/user-policies/discover` (synchronous)

**Request:** `{ url: string, organization_id: string | null }`

**Steps:**
1. Validate + normalize URL to an origin (`https://chatgpt.com`). Reuse the
   existing strict validator.
2. Rate-limit (reuse existing 5/hr + 10/day per-user limiters).
3. `firecrawl.map_policy_urls(origin)` → candidate URLs; `_infer_policy_type`
   each; dedup; drop non-policy noise.
4. Company resolution: look up an existing `CompanyDocument` by domain/slug.
   If found → return it (`matched: true`). If not → infer `{name, category}`
   via one cheap Anthropic call (domain + a few discovered page titles as
   context), `matched: false`.

**Response:**
```jsonc
{
  "company": { "matched": true|false, "name": "OpenAI", "slug": "openai",
               "category": "AI Chat", "main_url": "https://chatgpt.com" },
  "policies": [
    { "url": "https://openai.com/policies/privacy-policy",
      "policy_type": "privacy", "title": "Privacy Policy" }
  ]
}
```

No scraping/storage here — cheap and idempotent; safe to re-run.

## Component 2 — `POST /api/user-policies/ingest-stream` (SSE)

**Request:** `{ company: {name, slug, category, main_url}, organization_id,
policies: [{url, policy_type, title}] }` — the (possibly user-edited) company
fields plus the selected subset.

**Handler:**
1. Ensure the `CompanyDocument` exists; create it from the user-confirmed
   fields if `matched` was false. Stamp `origin_user_id`.
2. Iterate selected policies **sequentially**, emitting SSE frames:
   ```
   data: {"type":"start","total":3}
   data: {"type":"policy_begin","index":0,"title":"Privacy Policy","stage":"fetching"}
   data: {"type":"policy_stage","index":0,"stage":"refining"}
   data: {"type":"policy_stage","index":0,"stage":"indexing"}
   data: {"type":"policy_done","index":0,"result":"promoted|unchanged|updated|failed"}
   …
   data: {"type":"done","added":3,"failed":0}
   ```
3. Per policy: scrape → `clean_markdown` → `validate_content` → store-as-
   canonical, then upsert the user's Library row linking to it.
4. **Per-policy error isolation:** a failed scrape emits
   `policy_done result:"failed"` and the stream continues. One bad URL never
   kills the batch (matches orchestrator failure isolation).

## Promotion outcomes (per selected policy)

| Situation | Outcome | Action |
|---|---|---|
| URL in corpus, content unchanged | `unchanged` | Link Library row to existing canonical policy. |
| URL in corpus, content changed | `updated` | Run canonical update + diff path, then link. |
| URL not in corpus, company exists | `promoted` | New `PolicyDocument` (`source_kind="canonical"`) under company; link. |
| URL not in corpus, company new | `promoted` (+ company) | Create `CompanyDocument` from confirmed fields; promote policy; link. |

- **Company creation:** slug derived from name, collision-checked against
  existing slugs; `main_url` = submitted origin; company `id` becomes
  `author_id` on its policies (same shape as existing corpus → appears in
  sidebar + search immediately).
- **Change tracking is free:** promoted policies carry `source_url` and live in
  the corpus, so the existing weekly cron re-scrapes them and runs the
  phantom-filtered diff pipeline.

## Guardrails

1. **Same-domain enforcement** — every selected policy URL must share the
   registrable domain of the submitted main URL. Hard reject otherwise.
   Prevents mapping unrelated content onto a fabricated company name.
2. **Content validation** — reuse `validate_content`; non-policy pages emit
   `failed`, never stored.
3. **Selection cap** — max ~10 policies per submission (configurable).
4. **Rate limits** — existing 5/hr + 10/day per-user, applied to both
   `discover` and `ingest-stream`.
5. **Idempotent dedup** — match companies by domain before creating; match
   policies by `source_url`/content hash before promoting. Re-submitting the
   same site creates no duplicates.
6. **`origin_user_id` stamp** — recorded on promoted companies/policies from
   day one (no UI). Keeps audit/rollback possible without building a review
   gate now.

**Accepted trade-off:** promotion is globally visible with no human review gate
(per decision #2). Guardrails reduce junk/abuse; `origin_user_id` preserves the
option to add review/rollback later.

## Component 3 — Cinematic frontend

`SubmitPolicyDialog.tsx` becomes a state machine: `input → review → ingesting →
done`. The animated scene lives in its own component (`IngestProgress.tsx`) so
the dialog stays focused and the animation is iterable/testable in isolation.

**Tech:** `framer-motion` (existing dep) + the `AnimatedOrb` aesthetic from the
landing page.

**Scene (during the SSE stream):**
- Central **orb** that pulses and shifts hue per stage (calm "reading" →
  brighter "indexing" → settled "done") — the focal point that holds attention.
- **Stage caption** crossfading on the SSE `stage` field:
  - `fetching` → "Reading {title}…"
  - `refining` → "Cleaning up the legalese…"
  - `indexing` → "Filing it into the corpus…"
  - `tracking` → "Setting up change tracking…"
- **Policy ribbon:** selected policies as cards; active one lifts/glows,
  finished ones get a spring-animated check, failed ones dim with "couldn't
  read this one".
- Slim **progress meter** (index/total), subtle so the orb stays the star.
- `prefers-reduced-motion`: opacity crossfades + meter only, no large motion.

**Done state:** orb settles, ribbon all-checked, summary ("Added 3 policies to
OpenAI — now tracked for changes"), CTAs "View in Library" / "Add another".

**Failure framing:** honest summary ("Added 2, couldn't read 1") with failed
titles listed. If all fail, muted orb + retry.

**Transport:** reuse the existing client SSE parser from `api.ts` (the one
`streamQuery` uses) — no new transport code.

## Error handling

- Discovery failure (map errors / zero results): dialog shows "We couldn't find
  policy pages on that site — paste a more specific URL?" and lets the user
  retry. (`map_policy_urls` already degrades to empty list on error.)
- Company inference failure: fall back to a name derived from the domain +
  category "Other"; user edits in the review step.
- Per-policy scrape failure: isolated, streamed as `failed`, batch continues.
- Anthropic credit/quota errors during inference or analysis: surfaced as a
  toast, never a silent empty state (lesson from the prior streaming bug).

## Testing

**Backend (pytest):**
- `discover`: domain normalization; map results filtered/typed; existing-company
  match vs new-company inference; same-domain rejection of off-domain URLs;
  rate-limit enforcement.
- `ingest-stream`: each promotion outcome (`unchanged`/`updated`/`promoted`/
  `promoted+company`/`failed`); company creation with slug collision handling;
  per-policy error isolation (one failure doesn't abort the batch); SSE frame
  sequence shape; `origin_user_id` stamping; selection cap enforcement;
  idempotent re-submit creates no duplicate company/policy.
- Reuse existing fakes for the policy store / storage / scraper.

**Frontend:**
- Dialog state machine transitions (`input→review→ingesting→done`).
- SSE event handling drives ribbon/orb/caption state correctly, including a
  `failed` event and an all-failed run.
- `prefers-reduced-motion` fallback renders without large motion.

## Out of scope

- Human review/approval queue for promoted policies (explicitly deferred;
  `origin_user_id` keeps the door open).
- Background job queue / cross-session resumability (SSE chosen; closing the tab
  stops remaining scrapes, finished ones persist).
- Editing/removing a company from the corpus via UI.
