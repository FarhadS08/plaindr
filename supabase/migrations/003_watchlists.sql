-- Personal company watchlists.
--
-- One row per (user, company). Composite PK prevents duplicates and
-- lets us UPSERT without extra plumbing. Designed for the Overview's
-- CompanyWatchlist widget and any future "filter all views to my
-- watchlist only" toggle — everything keys off user_id.

create table if not exists watchlist_entries (
  user_id    text        not null,                       -- Clerk user id
  company_id uuid        not null,
  added_at   timestamptz not null default now(),
  primary key (user_id, company_id)
);

-- Fast per-user listing ordered by most-recently-added.
create index if not exists watchlist_entries_user_added_idx
  on watchlist_entries (user_id, added_at desc);
