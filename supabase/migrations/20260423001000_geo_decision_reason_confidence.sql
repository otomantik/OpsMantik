-- Geo decision audit contract (Phase 2/3):
-- Persist deterministic geo reason/confidence so Helsinki/ghost regressions are debuggable.

alter table if exists public.sessions
  add column if not exists geo_source text,
  add column if not exists geo_city text,
  add column if not exists geo_district text,
  add column if not exists geo_updated_at timestamptz,
  add column if not exists geo_reason_code text,
  add column if not exists geo_confidence integer;

alter table if exists public.calls
  add column if not exists location_source text,
  add column if not exists district_name text,
  add column if not exists click_id text,
  add column if not exists gclid text,
  add column if not exists wbraid text,
  add column if not exists gbraid text,
  add column if not exists location_reason_code text,
  add column if not exists location_confidence integer;
