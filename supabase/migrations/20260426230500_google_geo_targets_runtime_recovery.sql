-- Runtime recovery: restore google geo targets lookup table used by sync/call-event geo enrichment.
create table if not exists public.google_geo_targets (
  criteria_id bigint primary key,
  name text not null,
  canonical_name text not null,
  parent_id bigint null,
  country_code text null,
  target_type text null,
  status text null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_google_geo_targets_country_code
  on public.google_geo_targets (country_code);

create index if not exists idx_google_geo_targets_target_type
  on public.google_geo_targets (target_type);

grant select on public.google_geo_targets to anon, authenticated, service_role;
grant insert, update, delete on public.google_geo_targets to service_role;
