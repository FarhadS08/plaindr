-- Org invites.
--
-- Two shapes in one table:
--   - Email-gated: `email` set, only that email can accept.
--   - Link: `email` null, any signed-in user with the code can accept.
--
-- `code` is the URL-safe random string we put in /invite/:code links.
-- It's surface-public, so it needs to be unguessable (generated via
-- gen_random_uuid()::text with dashes stripped in the RPC below).

create table if not exists org_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code            text unique not null,
  email           text,
  role            text not null default 'member'
    check (role in ('admin', 'member')),
  invited_by      text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '14 days',
  accepted_at     timestamptz,
  accepted_by     text
);

create index if not exists org_invites_org_idx
  on org_invites (organization_id, accepted_at);
create index if not exists org_invites_email_idx
  on org_invites (lower(email)) where email is not null;

alter table org_invites enable row level security;

-- Admins see / manage invites for their org. The accept flow uses a
-- SECURITY DEFINER RPC below so it can read by code without needing a
-- policy that would expose invites to anyone.

drop policy if exists "invite admin read"    on org_invites;
drop policy if exists "invite admin insert"  on org_invites;
drop policy if exists "invite admin delete"  on org_invites;

create policy "invite admin read" on org_invites
  for select using (is_org_admin(organization_id));
create policy "invite admin insert" on org_invites
  for insert with check (is_org_admin(organization_id));
create policy "invite admin delete" on org_invites
  for delete using (is_org_admin(organization_id));

-- ── accept-invite RPC ────────────────────────────────────────
-- Runs as postgres so it can:
--   1) look up the invite by code (bypassing RLS),
--   2) verify the invite matches the caller (email, expiry, not accepted),
--   3) insert the membership row,
--   4) mark the invite accepted.
-- Returns minimal org info the client needs to redirect.

create or replace function accept_invite(p_code text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid   text;
  mail  text;
  inv   org_invites%rowtype;
begin
  uid := auth.uid()::text;
  if uid is null or uid = '' then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into inv from org_invites where code = p_code;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if inv.accepted_at is not null then
    raise exception 'invite already used' using errcode = 'P0003';
  end if;
  if inv.expires_at < now() then
    raise exception 'invite expired' using errcode = 'P0004';
  end if;

  if inv.email is not null then
    select email into mail from auth.users where id = uid::uuid;
    if lower(mail) is distinct from lower(inv.email) then
      raise exception 'invite is for a different email' using errcode = 'P0005';
    end if;
  end if;

  -- Already a member? Treat as a no-op success; still mark accepted.
  insert into organization_members (organization_id, user_id, role)
  values (inv.organization_id, uid, inv.role)
  on conflict (organization_id, user_id) do nothing;

  update org_invites
     set accepted_at = now(), accepted_by = uid
   where id = inv.id;

  return jsonb_build_object(
    'organization_id', inv.organization_id,
    'role', inv.role
  );
end;
$$;

revoke all on function accept_invite(text) from public;
grant execute on function accept_invite(text) to authenticated;

-- ── lookup-invite RPC ────────────────────────────────────────
-- Returns a safe preview of the invite for the /invite/:code page:
-- org name + role + expiry + whether the viewer's email matches.
-- Does NOT leak the inviter's id or org members.

create or replace function peek_invite(p_code text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  inv   org_invites%rowtype;
  org   organizations%rowtype;
  uid   text;
  mail  text;
  email_matches boolean := true;
begin
  select * into inv from org_invites where code = p_code;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into org from organizations where id = inv.organization_id;

  uid := auth.uid()::text;
  if uid is not null and uid <> '' and inv.email is not null then
    select email into mail from auth.users where id = uid::uuid;
    email_matches := lower(mail) is not distinct from lower(inv.email);
  end if;

  return jsonb_build_object(
    'found', true,
    'organization_name', org.name,
    'organization_slug', org.slug,
    'role', inv.role,
    'email', inv.email,
    'expires_at', inv.expires_at,
    'accepted_at', inv.accepted_at,
    'email_matches', email_matches
  );
end;
$$;

revoke all on function peek_invite(text) from public;
grant execute on function peek_invite(text) to authenticated, anon;
