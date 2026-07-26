# Plaindr — Whole-Application Security Audit

**Date:** 2026-07-25
**Scope:** Entire application — Python FastAPI backend, Node/tRPC server, React client, Supabase Postgres RLS + Storage, build/deploy config.
**Method:** Manual data-flow tracing from untrusted input to sink across every router, client, migration, and storage path. Each finding below was verified by reading the actual code; the two most severe were independently confirmed by two reviewers.

---

> **Remediation status (branch `fix/security-hardening`, 2026-07-26):** SEC-01 through SEC-09 are all fixed on this branch. Backend: 366 tests pass (30 new), ruff clean; frontend: `tsc` clean, 127 logic tests pass (8 pre-existing network-integration failures unrelated to these changes), production build succeeds. See §8 for the per-finding fix map. **The three SQL migrations (012–014) still need to be applied to the Supabase database** — code fixes ship in the app, but the RLS/policy changes only take effect once the migrations run.

## 1. Executive summary

Plaindr is a multi-tenant SaaS. The audit found **two Critical, three High, two Medium, and two Low** issues that are concretely exploitable. They are not scattered mistakes — they trace back to **two false trust assumptions baked into the architecture**:

1. **"The API (tRPC/FastAPI) is the authorization boundary."**
   It isn't. The browser ships the **public Supabase anon key** and talks to Supabase **PostgREST directly** (it inserts conversations/messages client-side). So for every table, **Postgres Row-Level Security (RLS) — not the TypeScript/Python code — is the real trust boundary.** Any "ownership check" written in `server/routers.ts` is bypassable by calling `https://<project>.supabase.co/rest/v1/...` directly with a normal logged-in session. Two tables get this wrong.

2. **"The FastAPI backend runs on a trusted internal network."**
   It doesn't. The React client calls the FastAPI backend **directly** via `VITE_API_URL` (`client/src/lib/api.ts`), so the backend is a **public internet endpoint**. Several of its endpoints are **unauthenticated** and trust scoping identifiers supplied in the request body.

Fixing the root causes (enable RLS everywhere with correct policies; authenticate the FastAPI backend and stop trusting body-supplied identity) closes most of the report.

### Severity table

| ID | Severity | Confidence | Title | Primary location |
|----|----------|-----------|-------|------------------|
| SEC-01 | **Critical** | 9/10 | `user_policies` has RLS disabled → full cross-tenant read/write/delete | `supabase/migrations/011_user_policies.sql:64` |
| SEC-02 | **Critical** | 9/10 | Broken `organization_members` INSERT policy → any user takes over any org as owner | `supabase/migrations/006_rls_policies.sql:179-185` |
| SEC-03 | **High** | 8/10 | Unauthenticated `/api/query` trusts body `user_id`/`organization_id` → cross-tenant data disclosure | `backend/.../routers/query.py:24-35, 57-74` |
| SEC-04 | **High** | 8/10 | PostgREST filter injection in retriever → dump **all** tenants' submissions | `backend/.../inference/retriever.py:130-134, 142` |
| SEC-05 | **High** | 9/10 | Readable SSRF via scrape URL (attacker controls host+protocol) → cloud-metadata/internal read | `backend/.../routers/user_policies.py:181-203, 746-844` |
| SEC-06 | **Medium** | 8/10 | Org admin self-escalates to owner via direct PATCH (UPDATE policy ignores new role) | `supabase/migrations/006_rls_policies.sql:186-188` |
| SEC-07 | **Medium** | 7/10 | `storage_path` trusted verbatim → cross-tenant object read/delete (chains with SEC-01) | `backend/.../clients/storage.py:245-256` |
| SEC-08 | **Low** | 7/10 | `peek_invite` returns invitee email to anonymous callers (PII) | `supabase/migrations/008_invites.sql:140-154` |
| SEC-09 | **Low** | 7/10 | `auth.me` echoes the caller's access token in the response body | `server/routers.ts:44` |

---

## 2. Critical findings

### SEC-01 — `user_policies` has RLS disabled → full cross-tenant read/write/delete

- **Category:** `rls_gap` / `idor`
- **Location:** `supabase/migrations/011_user_policies.sql:64` — `alter table user_policies disable row level security;`
- **Severity:** Critical · **Confidence:** 9/10

**Description.** `user_policies` lives in the `public` schema, which Supabase auto-exposes through PostgREST, and no migration ever `REVOKE`s the default grants to `anon`/`authenticated`. With RLS **disabled**, the table is fully exposed to anyone holding the public anon key (which ships in the browser bundle) plus any logged-in session. The migration comment claims "the API (tRPC + FastAPI) authorizes every read/write" — but that only guards the API; **PostgREST bypasses the API entirely.** This is exactly the mistake `005_organizations.sql` originally made and `006` corrected — `user_policies` never got that correction.

**Exploit.** Any authenticated user, hitting PostgREST directly:
```
GET    /rest/v1/user_policies?select=*                 → every tenant's private submissions (URLs, titles, owner ids, storage paths)
DELETE /rest/v1/user_policies?id=eq.<any-uuid>         → delete anyone's Library row
POST   /rest/v1/user_policies { user_id/org forged }   → forge rows attributed to other tenants
PATCH  /rest/v1/user_policies?id=eq.<row> { storage_path:"<victim>/..." }  → set up SEC-07
```
Confidentiality: leaks which URLs each user/org is privately researching. Integrity: mass-delete or forge other tenants' rows.

**Fix.** Enable RLS and add owner/member-scoped policies mirroring the org-scope tables:
```sql
alter table user_policies enable row level security;

create policy "up read" on user_policies for select using (
  user_id = current_user_id()
  OR (organization_id is not null and is_org_member(organization_id))
);

create policy "up insert" on user_policies for insert with check (
  (user_id = current_user_id() and organization_id is null)
  OR (organization_id is not null and is_org_member(organization_id))
);

create policy "up modify" on user_policies for update using (user_id = current_user_id())
  with check (user_id = current_user_id());

create policy "up delete" on user_policies for delete using (user_id = current_user_id());
```
The service-role FastAPI backend bypasses RLS, so its code paths keep working unchanged. Alternatively/additionally `revoke all on user_policies from anon, authenticated;` so only the service role can touch it.

---

### SEC-02 — Broken `organization_members` INSERT policy → any user takes over any org

- **Category:** `privilege_escalation` / `rls_gap`
- **Location:** `supabase/migrations/006_rls_policies.sql:179-185` (policy `"admins add member"`)
- **Severity:** Critical · **Confidence:** 9/10

**Description.** The membership INSERT policy is:
```sql
create policy "admins add member" on organization_members
  for insert with check (
    is_org_admin(organization_id) OR user_id = current_user_id()
  );
```
The `user_id = current_user_id()` branch places **no constraint on `organization_id` and no constraint on `role`** (the column check-constraint permits `'owner'`). The intended self-join path is the `accept_invite` SECURITY DEFINER RPC, which validates the invite code/email/expiry — this raw clause bypasses all of it.

**Exploit.** A signed-in attacker who knows a victim org's UUID (org UUIDs are identifiers, not secrets — they leak via `organizations.list`, org-scoped conversation/watchlist rows, and URLs) calls PostgREST directly:
```
POST /rest/v1/organization_members
{ "organization_id": "<victim-org-uuid>", "user_id": "<attacker-uid>", "role": "owner" }
```
`with check` evaluates `is_org_admin(victim)=false OR user_id=current_user_id()=true` → insert succeeds. The attacker is now an **owner** and, via the other policies, can read every org-shared conversation, message, and watchlist, edit the org compliance profile, rename/delete the org, and remove real members. `organizations.removeMember` becomes unenforceable — a removed member simply re-inserts themselves.

**Fix.** Remove the self-insert branch; route all joins through `accept_invite` (SECURITY DEFINER). If a self-insert path must remain, bind it to a valid invite and force `role='member'`:
```sql
create policy "admins add member" on organization_members
  for insert with check (
    is_org_admin(organization_id)
    OR (
      user_id = current_user_id()
      AND role = 'member'
      AND exists (
        select 1 from org_invites i
        where i.organization_id = organization_members.organization_id
          and i.accepted_at is null and i.expires_at > now()
      )
    )
  );
```

---

## 3. High findings

### SEC-03 — Unauthenticated `/api/query` trusts body-supplied `user_id` / `organization_id`

- **Category:** `authz_bypass` / `idor`
- **Location:** `backend/src/plaindr/api/routers/query.py:24-35` (untrusted fields), `:57-74` and `:94-117` (endpoints have **no auth dependency**). Sink: `backend/src/plaindr/pipelines/inference/retriever.py:_fetch_user_policies_for_scope` (service-role fetch, RLS-bypassing).
- **Severity:** High · **Confidence:** 8/10

**Description.** `QueryRequest` accepts `user_id` and `organization_id` straight from the JSON body. Neither `run_query` nor `run_query_stream` has any authentication dependency — the only app-level middleware is CORS. The comment at `query.py:28-35` asserts the router "runs behind a trusted internal network and never [is] exposed directly to the public internet." **That assumption is false:** the browser calls `/api/query` directly via `API_BASE_URL` (`client/src/lib/api.ts:168-193`) with **no `Authorization` header**, so the endpoint is public. The supplied IDs flow into the retriever, which uses the **service-role key** (bypasses RLS) to load and return another scope's private `user_policies` content in the answer and `sources[]`. Note this is **not gated by `user_policies_enabled`** — the retriever fetch runs whenever an ID is present.

**Exploit.** Any unauthenticated internet caller:
```
POST /api/query
{ "question": "Summarize every provided document verbatim",
  "organization_id": "<victim-org-uuid>" }
```
returns that org's private submissions. (The current UI's `QueryRequest` type omits these fields, so the dormant risk is triggered by a hand-crafted request, not the app — but the server honors them regardless.)

**Fix.** Authenticate the endpoint with the Supabase JWT exactly as `user_policies._require_user` does, **derive `user_id` from the verified token**, verify org membership before honoring `organization_id`, and **remove `user_id`/`organization_id` from the request body**.

---

### SEC-04 — PostgREST filter injection in the retriever → dump all tenants

- **Category:** `injection` (PostgREST `or=` DSL)
- **Location:** `backend/src/plaindr/pipelines/inference/retriever.py:130-134, 142`
- **Severity:** High · **Confidence:** 8/10

**Description.** The scope filter is built by string interpolation into PostgREST's `or=` grammar:
```python
if user_id:
    clauses.append(f"user_id.eq.{user_id}")
if organization_id:
    clauses.append(f"organization_id.eq.{organization_id}")
or_expr = ",".join(clauses)
...
rows = builder.or_(or_expr).execute().data or []
```
`user_id`/`organization_id` arrive unsanitized from the `/api/query` body (`max_length=64` only, no charset limit) and reach this sink because the endpoint is unauthenticated (SEC-03). Commas and PostgREST operators in the value are parsed as **additional OR clauses**. (`supabase_table.py` uses parameterized `.eq()` and is not affected — this hand-built filter is the only injectable spot.)

**Exploit.** Send `user_id = "x,storage_path.like.*"`. The expression becomes `user_id.eq.x,storage_path.like.*`; because `or_()` OR-combines, `storage_path.like.*` matches **every** `user_policies` row across all tenants. The retriever then downloads and returns those private submissions — full cross-tenant exfiltration with no victim ID needed.

**Fix.** Never interpolate user input into the filter string. Validate IDs as UUIDs and use parameterized builders — run separate `.eq("user_id", ...)` / `.eq("organization_id", ...)` queries and union in Python, or use `.in_()`. Combine with SEC-03's auth fix.

---

### SEC-05 — Readable SSRF via user-submitted scrape URL (host + protocol controlled)

- **Category:** `ssrf`
- **Location:** `backend/src/plaindr/api/routers/user_policies.py:181-203` (`_validate_url`, the only gate); reachable from `POST /api/user-policies/submit` (`:253`), `/discover` (`:520`), `/ingest-stream` (`:750`). Sinks: `clients/playwright.py` `page.goto(url)` and `clients/_shared.py` `httpx` fetch with `follow_redirects=True`.
- **Severity:** High · **Confidence:** 9/10 (requires the `user_policies_enabled` flag + an authenticated user)

**Description.** `_validate_url` checks only that the scheme is `http`/`https` and a host is present — **no block on internal/private destinations.** The default `scraper_backend="hybrid"` runs Playwright **inside the backend process**, so `page.goto(url)` hits the attacker-chosen host, and the fetched content is returned to the caller (`SubmitResponse.markdown`) — a **readable** SSRF. Two aggravators:
- `/ingest-stream` **never calls `_validate_url`** (`user_policies.py:746-844`). Its only guard is that each policy URL shares a "registrable domain" with the submitted `company.main_url` — but `_registrable_domain` just takes the last two dot-labels, so `169.254.169.254` → `"169.254"` for *both* the company URL and the policy URL, and the guard passes.
- The PDF/pagination/iframe fallbacks issue `httpx` GETs with `follow_redirects=True`, so even a "public" URL can 302 to `169.254.169.254`.

**Exploit.** An authenticated user (feature enabled) submits `{"url":"http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>"}` and receives the cloud IAM credentials in the response `markdown`. Same technique reads `http://localhost:PORT/...`, internal `10.x`/`192.168.x` services, and port-scans the internal network.

**Fix.** Before scraping, resolve the host and **reject loopback/private/link-local/reserved ranges** (`169.254.0.0/16`, `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `::1`, `fc00::/7`, `fe80::/10`). Re-validate after DNS resolution (defeat rebinding), and either disable redirects or re-check each hop's resolved IP. Apply the **same validation in `/ingest-stream`** (it currently skips it) and replace the last-two-labels domain check with a real public-suffix comparison.

---

## 4. Medium findings

### SEC-06 — Org admin self-escalates to owner via direct PATCH

- **Category:** `privilege_escalation`
- **Location:** `supabase/migrations/006_rls_policies.sql:186-188` (policy `"admins update member"`)
- **Severity:** Medium · **Confidence:** 8/10

**Description.**
```sql
create policy "admins update member" on organization_members
  for update using (is_org_admin(organization_id))
  with check (is_org_admin(organization_id));
```
`is_org_admin` is true for both `admin` and `owner`, and the `with check` re-verifies only admin-ness, **not the new `role` value**. The careful Node guards in `organizations.updateMemberRole` (blocks granting ownership, blocks demoting the last owner) live in TypeScript and are bypassed by a direct PostgREST `PATCH`.

**Exploit.** A mere `admin` runs `PATCH /rest/v1/organization_members?organization_id=eq.<org>&user_id=eq.<self> {"role":"owner"}` → becomes owner, then can demote the real owner or delete the org.

**Fix.** Encode role-transition rules in RLS (or move all role changes into a SECURITY DEFINER RPC): forbid non-owners from writing `role='owner'` and from modifying owner rows; add a trigger blocking demotion of the last owner.

---

### SEC-07 — `storage_path` trusted verbatim on download/delete

- **Category:** `path_traversal` / `idor`
- **Location:** `backend/src/plaindr/clients/storage.py:245-256`; consumed at `backend/.../routers/user_policies.py:446` (download) and `:489` (delete).
- **Severity:** Medium · **Confidence:** 7/10 (chains with SEC-01 for full impact)

**Description.** `download_user_policy` / `delete_user_policy` pass `row["storage_path"]` straight to Supabase Storage with no check that it sits under the caller's `"<owner_id>/"` prefix. That is only safe if the stored path is trustworthy — but SEC-01 lets an attacker set it to anything. Chained: attacker `POST`s a `user_policies` row (via PostgREST) with `user_id=<self>`, `is_canonical_mirror=false`, `storage_path="<victim-org-uuid>/<file>.md"`, then calls `GET /api/user-policies/{id}/markdown`; `_row_visible_to_caller` passes (row is theirs), and the service-role client downloads another tenant's private object. `DELETE` removes it. *(The write/submit path is safe — `_slugify` collapses `../` and `owner_id` is server-derived.)*

**Fix (defense-in-depth, independent of SEC-01).** Before download/delete, assert `storage_path` starts with the owner prefix the caller is authorized for and contains no `..` segment. Prefer **re-deriving** the prefix from the row's already-validated `user_id`/`organization_id` rather than trusting the free-text column.

---

## 5. Low findings

### SEC-08 — `peek_invite` leaks invitee email to anonymous callers

- **Location:** `supabase/migrations/008_invites.sql:140-154` (returns `'email', inv.email`; `grant execute ... to anon`).
- **Severity:** Low · **Confidence:** 7/10

The SECURITY DEFINER `peek_invite` is granted to `anon` and returns the raw invited `email` (PII) plus org name/slug to anyone who submits a code — no auth required. Codes are unguessable UUIDs, which bounds severity, but a forwarded `/invite/:code` link exposes the target's email even while signed out. **Fix:** drop `email` from the return (the existing `email_matches` boolean already covers the "is this for me?" UI), or gate the email field behind an authenticated caller.

### SEC-09 — `auth.me` echoes the access token in its response

- **Location:** `server/routers.ts:44` — `me: publicProcedure.query(opts => opts.ctx.user)` returns the full `AuthedUser`, including `accessToken`.
- **Severity:** Low · **Confidence:** 7/10

Not a cross-user leak (the client already holds its own token), but returning the bearer token in a query response body widens its exposure to logs/caches/interceptors unnecessarily. **Fix:** strip `accessToken` (and any other server-only fields) from the returned shape.

---

## 6. Cross-cutting root causes & remediation order

**Root cause A — RLS is the real boundary, and two tables don't enforce it.** Fix SEC-01, SEC-02, SEC-06 first: they are one-to-a-few lines of SQL each and close browser-reachable cross-tenant takeover/exfiltration. Add a **schema-wide invariant test** that fails CI if any `public` table has RLS disabled or lacks both a `USING` and a `WITH CHECK` policy.

**Root cause B — the FastAPI backend is public and partly unauthenticated.** Fix SEC-03/SEC-04/SEC-05: authenticate `/api/query` and `/api/query/stream` with the Supabase JWT, derive identity from the token (never the body), and add SSRF egress filtering to the shared scrape path (used by submit/discover/ingest-stream). The "trusted internal network" comment is factually wrong given the client hits the backend directly — delete it so it stops justifying missing auth.

**Suggested sprint order**

1. **SEC-01, SEC-02** — enable RLS on `user_policies`; fix the membership INSERT policy. *(Highest impact, smallest change.)*
2. **SEC-03 + SEC-04** — authenticate the query router; remove body-supplied identity; parameterize the retriever filter.
3. **SEC-05** — SSRF egress allowlist/denylist on the scrape path; apply to `/ingest-stream`; real public-suffix domain check.
4. **SEC-06, SEC-07** — role-transition rules in RLS; storage-path prefix assertion.
5. **SEC-08, SEC-09** — trim PII/token from responses.

---

## 7. Checked and found safe (coverage notes)

So the report's silence on these is a positive result, not a gap:

- **Secret hygiene (client bundle):** genuinely-sensitive keys (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, `ELEVENLABS_API_KEY`, `ADMIN_TOKEN`, `MONGODB_URI`) all use **non-`VITE_` prefixes**, so Vite never inlines them; grepping `dist/` for the literal values returns zero hits. Only the public `VITE_SUPABASE_ANON_KEY`/`VITE_SUPABASE_URL` reach the browser, by design.
- **Committed secrets:** `.env` is untracked and gitignored; `git log --all -- .env` is empty; history searches for the key values return nothing. *(Advisory: the local `.env` holds live-looking prod credentials — rotate anything that has ever left this machine, and prefer a secrets manager.)*
- **XSS:** the live RAG renderer (`AnswerCard.tsx`) uses `react-markdown` + `remark-gfm` with **no `rehype-raw`**; `chart.tsx`'s `dangerouslySetInnerHTML` is developer-supplied theme CSS, not user input. *(Latent/hardening: `AIChatBox.tsx` uses `<Streamdown>` with raw-HTML enabled, but it is only wired to a hardcoded demo page — keep untrusted RAG output off that component if it is ever promoted.)*
- **Auth/role handling:** `verifySupabaseSession` validates the JWT server-side via `getUser(token)`; `role` is read from `app_metadata` (server-controlled), not client-editable `user_metadata` — no role elevation. `adminSupabase` (service role) is defined but **never referenced** in `server/`; `adminProcedure`'s only consumer (`systemRouter.notifyOwner`) is never mounted, so there is no reachable admin surface.
- **Admin/webhook auth:** `store_admin._require_admin` and `voice._verify_elevenlabs_signature` both use `hmac.compare_digest` (timing-safe) and fail closed when unset (the only signature bypass requires `DEBUG=true`, which config marks "never enable in prod").
- **PostgREST injection (table client):** `supabase_table.py` uses parameterized `.eq()/.is_()/.gte()/.upsert()` with JWT-derived values — no string-built filters. The only injectable spot is the retriever (SEC-04).
- **Storage write path & ownership on user_policies read/delete:** `_user_policy_filename` slugifies host/path to `[a-z0-9-]`; `owner_id` is server-derived; `get_markdown`/`delete_policy` enforce `_row_visible_to_caller`/strict owner match.
- **Org RPCs:** `create_organization` and `accept_invite` (SECURITY DEFINER) correctly gate on `auth.uid()`, reject anon, and validate invite code/expiry/email/double-accept.
- **CSRF:** auth is bearer-header based (not cookie ambient), so tRPC POSTs aren't CSRF-able; the `sameSite:'none'` cookie helper is unused.

*(Hardening, out of scope but worth doing: add security headers/CSP in `vercel.json`; add a replay/timestamp check to the ElevenLabs webhook.)*

---

## 8. Remediation map (branch `fix/security-hardening`)

| ID | Fix shipped | Where |
|----|-------------|-------|
| SEC-01 | Enable RLS on `user_policies` + owner/member read/insert/update/delete policies | `supabase/migrations/012_user_policies_rls.sql` |
| SEC-02 | Drop the raw self-insert branch — joins go only through `accept_invite`; direct inserts require existing admin/owner | `supabase/migrations/013_org_member_policy_fixes.sql` |
| SEC-03 | `/api/query` + `/api/query/stream` derive `user_id` from a verified Bearer token (`_optional_user`); `organization_id` honored only after `is_org_member` (`_resolve_scope`); `user_id` removed from the request body | `backend/.../routers/query.py` |
| SEC-04 | `_safe_scope_id` rejects any scope id with PostgREST metacharacters before it reaches the `or=` filter | `backend/.../inference/retriever.py` |
| SEC-05 | SSRF guard: `assert_url_allowed` (no-DNS) in `_validate_url` and `/ingest-stream`; `resolve_and_assert_public` (DNS) at the fetch boundary in `scrape_single_url` | `backend/.../utils/url_guard.py`, `routers/user_policies.py`, `feature/single_scrape.py` |
| SEC-06 | Split UPDATE policies: only owners may grant/transfer ownership or edit owner rows; admins limited to non-owner rows; trigger blocks last-owner loss | `supabase/migrations/013_org_member_policy_fixes.sql` |
| SEC-07 | `_assert_owned_storage_path` asserts the row's `storage_path` sits under the owner's namespace (no `..`) before download/delete | `backend/.../routers/user_policies.py` |
| SEC-08 | `peek_invite` returns `email` only to the authenticated, matching recipient | `supabase/migrations/014_peek_invite_pii.sql` |
| SEC-09 | `auth.me` strips `accessToken` from the returned user shape | `server/routers.ts` |

**New regression tests (30):** `test_url_guard.py`, `test_query_scope.py`, `test_scope_id_safety.py`, `test_storage_path_guard.py`, plus an internal-URL case in `test_single_scrape.py`.

**Deploy step (required):** run migrations 012–014 against Supabase (`pnpm db:push` or the Supabase CLI). Until then the RLS/policy fixes (SEC-01/02/06/08) are inert even though the code is merged.
