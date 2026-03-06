-- Migration: causal_dna_ledger_failures DLQ table
-- Created for P2-L3: captures failed append_causal_dna_ledger RPC calls so they
-- can be reconciled offline instead of being silently discarded.

create table if not exists public.causal_dna_ledger_failures (
  id             uuid        primary key default gen_random_uuid(),
  site_id        uuid        not null references public.sites(id) on delete cascade,
  aggregate_type text        not null check (aggregate_type in ('conversion', 'signal', 'pv')),
  aggregate_id   uuid,
  causal_dna     jsonb,
  error_message  text,
  created_at     timestamptz not null default now()
);

-- Retention: keep 90 days; a cron can purge older rows
comment on table public.causal_dna_ledger_failures is
  'Dead-letter queue for failed append_causal_dna_ledger RPC calls. Rows older than 90 days may be purged.';

create index if not exists idx_causal_dna_ledger_failures_site_created
  on public.causal_dna_ledger_failures (site_id, created_at desc);

-- RLS: service-role only (no user-facing reads needed)
alter table public.causal_dna_ledger_failures enable row level security;
