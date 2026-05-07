-- Phase 1.6e: ai_analyses table for daily AI analyst briefs
-- Stores the output from Adela's AI analyst (signal extraction + narrative brief)

create table if not exists public.ai_analyses (
  id            uuid primary key default gen_random_uuid(),
  report_date   date not null,
  signals       jsonb not null default '[]',
  brief_text    text not null,
  model_used    text not null,
  tokens_in     integer not null default 0,
  tokens_out    integer not null default 0,
  cost_usd      numeric(10,6) not null default 0,
  created_at    timestamptz not null default now(),
  unique (report_date)
);

alter table public.ai_analyses enable row level security;

create policy "service role full access"
  on public.ai_analyses
  for all
  to service_role
  using (true)
  with check (true);
