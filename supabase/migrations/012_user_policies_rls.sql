-- Enable Row-Level Security on user_policies.  [SECURITY]
--
-- 011 shipped this table with RLS disabled, on the theory that only the
-- API (tRPC + FastAPI) ever touches it. That assumption is false: the
-- browser holds the public anon key and can reach PostgREST directly, so
-- RLS — not the API — is the real trust boundary. With RLS off, any
-- authenticated user could read, delete, or forge every tenant's rows via
-- `/rest/v1/user_policies`. This migration closes that hole.
--
-- The service-role FastAPI backend bypasses RLS and is unaffected; these
-- policies only constrain the anon/authenticated PostgREST path.

alter table user_policies enable row level security;

drop policy if exists "user_policies read"   on user_policies;
drop policy if exists "user_policies insert"  on user_policies;
drop policy if exists "user_policies update"  on user_policies;
drop policy if exists "user_policies delete"  on user_policies;

-- Read: your own personal rows, plus rows owned by an org you belong to.
create policy "user_policies read" on user_policies
  for select using (
    user_id = current_user_id()
    OR (organization_id is not null AND is_org_member(organization_id))
  );

-- Insert: a personal row for yourself, or an org row for an org you're in.
-- (Exactly-one-owner is already enforced by the table check constraint.)
create policy "user_policies insert" on user_policies
  for insert with check (
    (user_id = current_user_id() AND organization_id is null)
    OR (organization_id is not null AND is_org_member(organization_id))
  );

-- Update / delete: only the owning user, on personal rows. Org-row writes
-- go through the service-role backend, never the browser.
create policy "user_policies update" on user_policies
  for update using (user_id = current_user_id())
  with check (user_id = current_user_id() AND organization_id is null);

create policy "user_policies delete" on user_policies
  for delete using (user_id = current_user_id());
