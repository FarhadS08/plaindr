-- Tighten organization_members write policies.  [SECURITY]
--
-- Two flaws in 006:
--
--   1. The INSERT policy allowed `user_id = current_user_id()` with no
--      invite and no role restriction, so ANY authenticated user could
--      self-insert as OWNER of ANY org (full cross-tenant takeover) by
--      POSTing directly to PostgREST.
--
--   2. The UPDATE policy re-checked only admin-ness, not the new role, so
--      a mere admin could PATCH their own row to `owner` (self-escalation)
--      or demote the real owner.
--
-- Fix: joins go exclusively through accept_invite() (SECURITY DEFINER,
-- which validates code/email/expiry and inserts the row itself, bypassing
-- RLS). The direct self-insert branch is removed. Role changes are split
-- so only owners may grant/transfer ownership or touch owner rows.

-- Owner check helper (admin/member helpers already exist from 006).
create or replace function is_org_owner(org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = org
      and user_id = current_user_id()
      and role = 'owner'
  );
$$;

drop policy if exists "admins add member"        on organization_members;
drop policy if exists "admins update member"     on organization_members;
drop policy if exists "owners update member"     on organization_members;
drop policy if exists "admins update non-owner"  on organization_members;

-- INSERT: only an existing admin/owner may add members directly. Users
-- join via accept_invite() (SECURITY DEFINER), never a raw self-insert.
create policy "admins add member" on organization_members
  for insert with check (is_org_admin(organization_id));

-- UPDATE (owners): may change any role, including ownership transfer.
create policy "owners update member" on organization_members
  for update using (is_org_owner(organization_id))
  with check (is_org_owner(organization_id));

-- UPDATE (admins, non-owner): may edit only non-owner rows and may never
-- grant ownership. `using` guards the existing row; `with check` the new.
create policy "admins update non-owner" on organization_members
  for update using (
    is_org_admin(organization_id) AND role <> 'owner'
  )
  with check (
    is_org_admin(organization_id) AND role <> 'owner'
  );

-- Guard against locking an org out of ownership: block demoting/removing
-- the last owner. Fires on the browser (RLS) path and the service role
-- alike, so it's a true invariant rather than an app-layer nicety.
create or replace function _forbid_last_owner_loss()
  returns trigger language plpgsql security definer
  set search_path = public as $$
declare
  remaining int;
begin
  -- Only relevant when an existing owner stops being an owner.
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role is distinct from 'owner') then
    select count(*) into remaining
      from organization_members
      where organization_id = old.organization_id
        and role = 'owner'
        and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'cannot remove the last owner of an organization'
        using errcode = 'P0006';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_forbid_last_owner_loss on organization_members;
create trigger trg_forbid_last_owner_loss
  before update or delete on organization_members
  for each row execute function _forbid_last_owner_loss();
