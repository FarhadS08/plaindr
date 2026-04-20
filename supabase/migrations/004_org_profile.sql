-- Organization / compliance profile — extends user_profiles with
-- enough detail to drive fit-scoring and profile-aware Ask Plaindr
-- queries. Kept on user_profiles (not a new table) because it's
-- still 1:1 with the user and avoids a join on every read.

alter table user_profiles
  add column if not exists industry                 text,
  add column if not exists organization_size        text,
  add column if not exists organization_name        text,
  add column if not exists compliance_requirements  text[] not null default '{}',
  add column if not exists data_residency           text,
  add column if not exists organization_notes       text;

-- Quick GIN index so future fit-score queries (e.g. "users needing
-- HIPAA") don't table-scan the compliance array.
create index if not exists user_profiles_compliance_gin
  on user_profiles using gin (compliance_requirements);
