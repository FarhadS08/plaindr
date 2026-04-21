-- User-submitted policy sources.
--
-- Users can paste a policy URL; Plaindr scrapes it synchronously and
-- either (a) refreshes the canonical version if the URL is already in
-- the global corpus, or (b) stores a private copy in the submitter's
-- personal or org namespace. Every submission joins the weekly rescrape
-- cron so changes over time are caught automatically — that's the
-- differentiator from NotebookLM-style one-shot uploads.
--
-- Scope is personal when organization_id is null, org-shared when set.
-- Mirrors the watchlist_entries / conversations pattern from 009 — same
-- coalesce-based unique index so (user, null, url) and (user, org, url)
-- are distinct rows and can coexist.

create table if not exists user_policies (
  id                  uuid primary key default gen_random_uuid(),
  user_id             text not null,                                  -- submitter, never rewritten
  organization_id     uuid references organizations(id) on delete cascade,
  url                 text not null,
  slug                text not null,                                  -- derived from url path; used in storage path
  title               text,
  storage_bucket      text not null default 'policies-user',
  storage_path        text not null default '',                       -- '' when is_canonical_mirror = true
  content_hash        text,
  is_canonical_mirror boolean not null default false,                 -- true when url is also in companies.yaml
  canonical_source_url text,                                          -- the canonical /policies path when mirror
  last_scraped_at     timestamptz,
  last_status         text not null default 'pending'
    check (last_status in ('pending', 'ok', 'unchanged', 'updated', 'failed')),
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One row per (owner-scope, url). Coalesce to a zero uuid so personal
-- (null org) rows don't collide with the same url submitted under an
-- org — same trick as watchlist_entries_unique_scope in 009.
drop index if exists user_policies_unique_scope;
create unique index user_policies_unique_scope
  on user_policies (
    user_id,
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(url)
  );

create index if not exists user_policies_org_idx
  on user_policies (organization_id, updated_at desc)
  where organization_id is not null;

-- Used by the weekly cron to batch-fetch rows ordered by staleness.
create index if not exists user_policies_rescrape_idx
  on user_policies (last_scraped_at asc);

alter table user_policies enable row level security;

drop policy if exists "user_policy scope read"  on user_policies;
drop policy if exists "user_policy scope write" on user_policies;

create policy "user_policy scope read" on user_policies
  for select using (
    user_id = current_user_id()
    OR (organization_id is not null AND is_org_member(organization_id))
  );

-- Writes require being the submitter AND (if org-scoped) a member of
-- the org. Matches the watchlist / conversations scope_write policy.
create policy "user_policy scope write" on user_policies
  for all using (user_id = current_user_id())
  with check (
    user_id = current_user_id()
    AND (
      organization_id is null
      OR is_org_member(organization_id)
    )
  );

-- updated_at trigger keeps the rescrape index meaningful without the
-- cron having to manage it manually.
create or replace function touch_user_policies() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_policies_touch on user_policies;
create trigger user_policies_touch before update on user_policies
  for each row execute function touch_user_policies();
