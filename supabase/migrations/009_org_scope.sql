-- Scope watchlists + conversations to orgs.
--
-- Rule: `organization_id` is NULL for personal items, set for
-- org-shared items. Users always see their personal items; org
-- members see all items tagged with the org they're in.
--
-- This is additive — existing rows stay personal. Switching active
-- org flips the UI's query scope; no backfill needed.

-- ── watchlist_entries ───────────────────────────────────────
-- Drop the user-only PK so (user, company) can coexist with
-- (org, company) without colliding. Replace with a surrogate PK
-- plus a composite uniqueness across the full ownership tuple.

alter table watchlist_entries
  add column if not exists id uuid default gen_random_uuid();

-- Backfill ids before promoting to PK.
update watchlist_entries set id = gen_random_uuid() where id is null;
alter table watchlist_entries alter column id set not null;

-- Drop the old composite PK if it's still the only PK.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'watchlist_entries'::regclass
      and contype = 'p'
      and conname = 'watchlist_entries_pkey'
  ) then
    -- Recreate only if the new PK isn't already on id.
    perform 1 from pg_index i
      join pg_class c on c.oid = i.indexrelid
      where i.indrelid = 'watchlist_entries'::regclass
        and i.indisprimary
        and pg_get_indexdef(i.indexrelid) like '%(id)%';
    if not found then
      alter table watchlist_entries drop constraint watchlist_entries_pkey;
      alter table watchlist_entries add primary key (id);
    end if;
  end if;
end $$;

alter table watchlist_entries
  add column if not exists organization_id uuid
    references organizations(id) on delete cascade;

-- Uniqueness: one row per (user, org-or-null, company). The
-- `coalesce(...,'zero-uuid')` trick lets us enforce uniqueness
-- even when organization_id is null.
drop index if exists watchlist_entries_unique_scope;
create unique index watchlist_entries_unique_scope
  on watchlist_entries (
    user_id,
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    company_id
  );

create index if not exists watchlist_entries_org_idx
  on watchlist_entries (organization_id, added_at desc)
  where organization_id is not null;

-- Re-scope RLS: users see their personal rows + anything visible in
-- their orgs. Writes still require the row's user_id to be the caller
-- (so members can only add / remove their own entries; the org tag
-- just decides who else can SEE them).

drop policy if exists "watchlist owner" on watchlist_entries;
drop policy if exists "watchlist scope read"  on watchlist_entries;
drop policy if exists "watchlist scope write" on watchlist_entries;

create policy "watchlist scope read" on watchlist_entries
  for select using (
    user_id = current_user_id()
    OR (organization_id is not null AND is_org_member(organization_id))
  );

create policy "watchlist scope write" on watchlist_entries
  for all using (user_id = current_user_id())
  with check (
    user_id = current_user_id()
    AND (
      organization_id is null
      OR is_org_member(organization_id)
    )
  );

-- ── conversations ──────────────────────────────────────────
-- Same shape: nullable organization_id, expanded RLS.

alter table conversations
  add column if not exists organization_id uuid
    references organizations(id) on delete cascade;

create index if not exists conversations_org_idx
  on conversations (organization_id, updated_at desc)
  where organization_id is not null;

drop policy if exists "conversation owner"       on conversations;
drop policy if exists "conversation scope read"  on conversations;
drop policy if exists "conversation scope write" on conversations;

create policy "conversation scope read" on conversations
  for select using (
    user_id = current_user_id()
    OR (organization_id is not null AND is_org_member(organization_id))
  );

-- Writes (new message, title update, delete) stay owner-only. Org
-- sharing is view-only for now — adding collab-editing means sorting
-- out authorship on each message, which belongs in a later wave.
create policy "conversation scope write" on conversations
  for all using (user_id = current_user_id())
  with check (
    user_id = current_user_id()
    AND (
      organization_id is null
      OR is_org_member(organization_id)
    )
  );

-- Messages follow their parent conversation's visibility.
drop policy if exists "message owner" on messages;
drop policy if exists "message scope read" on messages;
drop policy if exists "message scope write" on messages;

create policy "message scope read" on messages
  for select using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        AND (
          c.user_id = current_user_id()
          OR (c.organization_id is not null AND is_org_member(c.organization_id))
        )
    )
  );

create policy "message scope write" on messages
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
