-- Adela scraper audit table
--
-- Generic per-scrape audit row written by every Adela scraper after a
-- successful run. The richer domain rows (e.g. position_reports) live in
-- their own tables; this table is a uniform handle for Atlas, the health
-- endpoint, and ops queries that need to know "did scraper X run today".
--
-- Extracted payloads are stored as JSONB so future scrapers can reuse the
-- table without schema migrations. storage_path is the optional pointer to
-- the raw artifact in the adela-raw Storage bucket.
--
-- RLS: service role only. No anon / authenticated access. Scrapers run with
-- the Supabase service-role key; humans inspect via SQL Editor (also service
-- role). End users never need to read these rows.

create table if not exists public.adela_scrape_results (
  id uuid primary key default gen_random_uuid(),
  scraper text not null,
  scraped_at timestamptz not null default now(),
  rows jsonb not null default '{}'::jsonb,
  storage_path text,
  created_at timestamptz not null default now()
);

create index if not exists adela_scrape_results_scraper_idx
  on public.adela_scrape_results (scraper, scraped_at desc);

alter table public.adela_scrape_results enable row level security;

-- Service role bypasses RLS by default, but the policy below makes the
-- intent explicit and prevents anon/authenticated requests slipping through
-- if someone forgets to wire the service-role client.
drop policy if exists adela_scrape_results_service_role_only
  on public.adela_scrape_results;

create policy adela_scrape_results_service_role_only
  on public.adela_scrape_results
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.adela_scrape_results is
  'Per-scrape audit row written by Adela scrapers. Service role only.';
