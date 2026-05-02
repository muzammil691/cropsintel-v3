-- Adela audit log table (phase-1.00e-rem)
--
-- Per-action audit row written by every Adela scraper as the FINAL step of a
-- run. While adela_runs tracks the lifecycle (running/success/failed/skipped)
-- and adela_scrape_results stores the extracted payload, adela_audit_log is
-- the immutable post-hoc record for compliance/forensics — written even when
-- notify failed, so we always know that the scraper reached the end of its
-- pipeline.
--
-- RLS: service role only. Same posture as adela_scrape_results.

create table if not exists public.adela_audit_log (
  id uuid primary key default gen_random_uuid(),
  scraper text not null,
  run_id uuid,
  status text not null check (status in ('success', 'failed', 'skipped')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists adela_audit_log_scraper_idx
  on public.adela_audit_log (scraper, created_at desc);

create index if not exists adela_audit_log_run_id_idx
  on public.adela_audit_log (run_id);

alter table public.adela_audit_log enable row level security;

drop policy if exists adela_audit_log_service_role_only
  on public.adela_audit_log;

create policy adela_audit_log_service_role_only
  on public.adela_audit_log
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.adela_audit_log is
  'Immutable audit row written by Adela scrapers as the final pipeline step. Service role only.';
