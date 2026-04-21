-- User-submitted policies.
--
-- Unlike the canonical policy store (which lives in the `policies` bucket
-- and is keyed by crawler-discovered source_url), these rows are
-- individually owned either by a single user or by an organization.
--
-- Two modes per row:
--   - is_canonical_mirror=true → the row's URL happens to match a
--     canonical policy we already crawl. The user sees the same
--     content every other user sees; we don't duplicate storage.
--     `storage_path` is empty — reads fall through to the canonical
--     bucket.
--   - is_canonical_mirror=false → user-private content. We scraped
--     on demand and stashed the markdown at `storage_path` inside
--     the user_policies bucket. No other user sees it.
--
-- Scope: exactly one of (user_id, organization_id) must be set. The
-- submission endpoint enforces this; the table keeps the column-level
-- integrity check as a belt-and-braces backstop.
--
-- RLS: disabled, matching the rest of the Plaindr schema. The API
-- (tRPC + FastAPI) authorizes every read/write against the caller's
-- Clerk identity before touching service-role Supabase.

create table if not exists user_policies (
  id                    uuid primary key default gen_random_uuid(),
  user_id               text,
  organization_id       uuid references organizations(id) on delete cascade,
  url                   text not null,
  title                 text,
  content_hash          text,            -- md5 of cleaned markdown, null on failure
  storage_path          text not null default '', -- empty when is_canonical_mirror
  is_canonical_mirror   boolean not null default false,
  last_status           text not null default 'pending',
  last_scraped_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- exactly one owner
  constraint user_policies_owner_exactly_one
    check ((user_id is not null)::int + (organization_id is not null)::int = 1)
);

create index if not exists user_policies_user_idx
  on user_policies (user_id);

create index if not exists user_policies_org_idx
  on user_policies (organization_id);

create index if not exists user_policies_url_idx
  on user_policies (url);

-- Uniqueness: same URL submitted twice by the same owner should
-- upsert, not duplicate. Partial indexes because user_id and
-- organization_id are mutually exclusive.
create unique index if not exists user_policies_user_url_unique
  on user_policies (user_id, url)
  where user_id is not null;

create unique index if not exists user_policies_org_url_unique
  on user_policies (organization_id, url)
  where organization_id is not null;

alter table user_policies disable row level security;
