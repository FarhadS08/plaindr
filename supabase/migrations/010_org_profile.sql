-- Org-level compliance profile.
--
-- Same shape as the personal user_profiles fields — same option lists,
-- same semantics — but scoped to the organization instead of the user.
-- Drives the "which AI tools actually fit this org" flag surface.
--
-- Owner-only writes, member-visible reads. Read is through the
-- existing "org visible to members" policy on organizations, so no
-- extra policies here.

alter table organizations
  add column if not exists industry text,
  add column if not exists organization_size text,
  add column if not exists compliance_requirements text[] not null default '{}',
  add column if not exists data_residency text,
  add column if not exists notes text;

-- Owner-only UPDATE of the profile fields. We keep the existing
-- "org admin update" policy (name, slug via rename — admin+) and add
-- a separate owner-scoped check for the profile fields. Simpler to
-- enforce at the router layer so the RLS policy stays uniform; this
-- comment is the reminder.
