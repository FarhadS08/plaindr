-- Stop peek_invite from leaking the invitee's email to anonymous callers. [SECURITY]
--
-- 008's peek_invite is granted to `anon` and returned `inv.email`
-- unconditionally, so anyone holding an invite code (e.g. a forwarded
-- /invite/:code link) could read the target's email address while signed
-- out. We now include `email` ONLY when the caller is authenticated AND
-- their own email matches the invite — i.e. the legitimate recipient, who
-- already knows their address. Everyone else gets `email_matches` alone,
-- which is all the UI needs to prompt "sign in with the invited email".

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
  base  jsonb;
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

  base := jsonb_build_object(
    'found', true,
    'organization_name', org.name,
    'organization_slug', org.slug,
    'role', inv.role,
    'expires_at', inv.expires_at,
    'accepted_at', inv.accepted_at,
    'email_matches', email_matches
  );

  -- Reveal the address only to the authenticated, matching recipient.
  if uid is not null and uid <> '' and inv.email is not null
     and email_matches then
    base := base || jsonb_build_object('email', inv.email);
  end if;

  return base;
end;
$$;

revoke all on function peek_invite(text) from public;
grant execute on function peek_invite(text) to authenticated, anon;
