-- Bootstrap problem: "members can see an org" + "only the creator
-- can INSERT" + "must be a member to pass the SELECT policy on the
-- returned row" forms a chicken-and-egg. Two writes from the user's
-- RLS-scoped client can't atomically hand-off, and PostgREST's
-- returning-row SELECT makes it worse.
--
-- The fix is the usual Supabase pattern: a SECURITY DEFINER RPC that
-- takes the caller's identity from auth.uid() and does both writes
-- inside a single transaction, bypassing RLS for that bootstrap path
-- only. RLS still guards every subsequent read/write on these tables.
--
-- Authorization is explicit (auth.uid() must be present), so anon
-- callers get rejected the same way a protected tRPC procedure would.

create or replace function create_organization(p_name text, p_slug text)
  returns organizations
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid text;
  new_org organizations;
begin
  uid := auth.uid()::text;
  if uid is null or uid = '' then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into organizations (name, slug, created_by)
  values (trim(p_name), p_slug, uid)
  returning * into new_org;

  insert into organization_members (organization_id, user_id, role)
  values (new_org.id, uid, 'owner');

  return new_org;
end;
$$;

-- Only authenticated users should be able to create orgs.
revoke all on function create_organization(text, text) from public;
grant execute on function create_organization(text, text) to authenticated;
