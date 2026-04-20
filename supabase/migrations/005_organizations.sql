-- Wave 1 of the org/teams rollout. Gives us the minimal shape to
-- have users create organizations, be members with a role, and flip
-- a per-user "active organization" so queries can be scoped to it
-- without URL gymnastics.
--
-- Invites, teams, shared conversations, and policy discussion live
-- in follow-up migrations (006_invites, 007_teams, 008_collab). This
-- migration is strictly additive — solo users with null memberships
-- keep working.

-- 1. organizations ───────────────────────────────────────────
-- Slug is the URL-safe identifier we'll eventually use for invite
-- links (/invite/:code, not /invite/:slug, so slug collisions are
-- only cosmetic — still uniqueness-enforced to keep the member UI
-- from looking broken).
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 100),
  slug        text unique not null check (length(slug) between 2 and 64),
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. organization_members ────────────────────────────────────
-- Composite PK rules out duplicate memberships; role is an enum-like
-- check so the tRPC layer doesn't have to validate role on every
-- write.
create table if not exists organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         text not null,
  role            text not null default 'member'
    check (role in ('owner', 'admin', 'member')),
  joined_at       timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_members_user_idx
  on organization_members (user_id);

-- 3. active org pointer on user_profiles ─────────────────────
-- Nullable → "Personal" mode. On delete of an org we null this out
-- so the user falls back to personal instead of dangling.
alter table user_profiles
  add column if not exists active_organization_id uuid
    references organizations(id) on delete set null;

-- 4. RLS ──────────────────────────────────────────────────────
-- Plaindr enforces row-level access at the tRPC layer (Clerk-auth'd
-- procedures + ownership checks on every query), not via Supabase
-- RLS. Matches the existing tables (conversations, messages, etc).
-- Leaving RLS on with no policies would 42501 every insert, which
-- is exactly what happens without these two lines.
alter table organizations        disable row level security;
alter table organization_members disable row level security;
