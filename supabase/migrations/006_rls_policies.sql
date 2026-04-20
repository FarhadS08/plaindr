-- Row-Level Security.
--
-- Authentication is Supabase Auth. Every authenticated request
-- carries a valid JWT and Supabase sets `auth.uid()` to the user's
-- UUID automatically. These policies compare row ownership against
-- that value.
--
-- `user_id` columns are stored as TEXT (the UUID is cast to text
-- before storing). `current_user_id()` returns the same shape so
-- comparisons stay consistent across the whole schema.

-- ── helper functions ────────────────────────────────────────
-- security definer lets these bypass RLS themselves so policies
-- that reference them don't trigger infinite recursion when the
-- policy body queries the same table it's guarding.

create or replace function current_user_id() returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid()::text, '');
$$;

create or replace function is_org_member(org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = org
      and user_id = current_user_id()
  );
$$;

create or replace function is_org_admin(org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = org
      and user_id = current_user_id()
      and role in ('owner', 'admin')
  );
$$;

-- ── user_profiles ───────────────────────────────────────────
alter table user_profiles enable row level security;

drop policy if exists "profile owner"   on user_profiles;
drop policy if exists "profile update"  on user_profiles;
drop policy if exists "profile insert"  on user_profiles;
drop policy if exists "profile delete"  on user_profiles;
create policy "profile owner"  on user_profiles
  for select using (user_id = current_user_id());
create policy "profile update" on user_profiles
  for update using (user_id = current_user_id())
  with check (user_id = current_user_id());
create policy "profile insert" on user_profiles
  for insert with check (user_id = current_user_id());
create policy "profile delete" on user_profiles
  for delete using (user_id = current_user_id());

-- ── conversations ───────────────────────────────────────────
-- Wave 3 (sharing) will expand these to honor visibility + org
-- membership. For now: personal access only. Consistent with the
-- Wave 1 default visibility='personal'.

alter table conversations enable row level security;

drop policy if exists "conversation owner" on conversations;
create policy "conversation owner" on conversations
  for all using (user_id = current_user_id())
  with check (user_id = current_user_id());

-- ── messages ────────────────────────────────────────────────
-- Ownership reached via the parent conversation.

alter table messages enable row level security;

drop policy if exists "message owner" on messages;
create policy "message owner" on messages
  for all using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and c.user_id = current_user_id()
    )
  )
  with check (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and c.user_id = current_user_id()
    )
  );

-- ── watchlist_entries ───────────────────────────────────────
alter table watchlist_entries enable row level security;

drop policy if exists "watchlist owner" on watchlist_entries;
create policy "watchlist owner" on watchlist_entries
  for all using (user_id = current_user_id())
  with check (user_id = current_user_id());

-- ── tags + conversation_tags ────────────────────────────────
-- The tags router scopes by user_id; mirror that in RLS. Skip
-- gracefully if the table isn't present yet (older deploys).

do $$
begin
  if to_regclass('public.tags') is not null then
    execute 'alter table tags enable row level security';
    execute 'drop policy if exists "tag owner" on tags';
    execute $p$create policy "tag owner" on tags
      for all using (user_id = current_user_id())
      with check (user_id = current_user_id())$p$;
  end if;
  if to_regclass('public.conversation_tags') is not null then
    execute 'alter table conversation_tags enable row level security';
    execute 'drop policy if exists "conversation_tag owner" on conversation_tags';
    -- Scoped via the parent conversation.
    execute $p$create policy "conversation_tag owner" on conversation_tags
      for all using (
        exists (
          select 1 from conversations c
          where c.id = conversation_tags.conversation_id
            and c.user_id = current_user_id()
        )
      )
      with check (
        exists (
          select 1 from conversations c
          where c.id = conversation_tags.conversation_id
            and c.user_id = current_user_id()
        )
      )$p$;
  end if;
end $$;

-- ── organizations ───────────────────────────────────────────
-- Members can see their org. Anyone authed can insert a new org
-- (they become the `created_by`). Admins update, owners delete.

alter table organizations enable row level security;

drop policy if exists "org visible to members" on organizations;
drop policy if exists "org insert self"        on organizations;
drop policy if exists "org admin update"       on organizations;
drop policy if exists "org owner delete"       on organizations;

create policy "org visible to members" on organizations
  for select using (is_org_member(id));
create policy "org insert self" on organizations
  for insert with check (current_user_id() = created_by);
create policy "org admin update" on organizations
  for update using (is_org_admin(id))
  with check (is_org_admin(id));
create policy "org owner delete" on organizations
  for delete using (
    exists (
      select 1 from organization_members
      where organization_id = organizations.id
        and user_id = current_user_id()
        and role = 'owner'
    )
  );

-- ── organization_members ────────────────────────────────────
-- Members of an org can see its member list. Admins manage
-- (invite / role change / remove). Anyone can leave — scoped to
-- their own row via the delete policy.

alter table organization_members enable row level security;

drop policy if exists "members list visible"     on organization_members;
drop policy if exists "admins add member"        on organization_members;
drop policy if exists "admins update member"     on organization_members;
drop policy if exists "admins or self remove"    on organization_members;

create policy "members list visible" on organization_members
  for select using (
    user_id = current_user_id() OR is_org_member(organization_id)
  );
create policy "admins add member" on organization_members
  for insert with check (
    -- Two legal inserts:
    --   1) an admin inviting someone new
    --   2) a user accepting an invite and joining themselves
    is_org_admin(organization_id) OR user_id = current_user_id()
  );
create policy "admins update member" on organization_members
  for update using (is_org_admin(organization_id))
  with check (is_org_admin(organization_id));
create policy "admins or self remove" on organization_members
  for delete using (
    is_org_admin(organization_id) OR user_id = current_user_id()
  );
