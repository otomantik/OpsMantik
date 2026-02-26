-- Migration: Google Geo Targets lookup table
-- Date: 2026-02-26
--
-- Purpose: Resolve Google Ads {loc_physical_ms} criteria IDs into human-readable
--          district/city names at ingest time in the conversion worker.
--
-- Usage:  Populated by scripts/seed-geo-targets.ts (run once, update as needed).
--         Worker queries: SELECT name, canonical_name WHERE criteria_id = $1
--
-- RLS:    Read-only for authenticated & service_role. Write only via service_role seed script.

BEGIN;

-- ============================================================
-- 1) Create the lookup table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.google_geo_targets (
  criteria_id     bigint      PRIMARY KEY,              -- Google's numeric Criteria ID (e.g. 1012782)
  name            text        NOT NULL,                 -- Short display name (e.g. 'Şişli')
  canonical_name  text        NOT NULL,                 -- Full path (e.g. 'Şişli,İstanbul,Turkey')
  parent_id       bigint,                               -- Parent criteria_id (nullable; e.g. province → country)
  country_code    text,                                 -- ISO 3166-1 alpha-2 (e.g. 'TR')
  target_type     text,                                 -- 'City' | 'Province' | 'District' | 'Country' | 'Neighborhood'
  status          text        NOT NULL DEFAULT 'Active' -- 'Active' | 'Removed'
);

COMMENT ON TABLE  public.google_geo_targets IS
  'Google Ads geo target criteria IDs. Seeded from Google Geo Targets CSV. Read-only lookup for resolving {loc_physical_ms} ValueTrack IDs to district names.';

COMMENT ON COLUMN public.google_geo_targets.criteria_id    IS 'Primary key: Google Criteria ID returned by {loc_physical_ms}.';
COMMENT ON COLUMN public.google_geo_targets.name           IS 'Short human-readable geo name (e.g. Şişli).';
COMMENT ON COLUMN public.google_geo_targets.canonical_name IS 'Full CSV canonical name path (e.g. Şişli,İstanbul,Turkey).';
COMMENT ON COLUMN public.google_geo_targets.parent_id      IS 'Parent geo criteria_id (nullable).';
COMMENT ON COLUMN public.google_geo_targets.country_code   IS 'ISO 3166-1 alpha-2 country code (e.g. TR).';
COMMENT ON COLUMN public.google_geo_targets.target_type    IS 'Google geographic target type (City, Province, District, Country, etc.).';
COMMENT ON COLUMN public.google_geo_targets.status         IS 'Active or Removed per Google CSV.';

-- ============================================================
-- 2) Indexes
-- ============================================================

-- Used by worker geo-resolution lookup (already PK, but document intent)
-- criteria_id is already indexed as PK.

-- Used by dashboard geo breakdowns filtered by country
CREATE INDEX IF NOT EXISTS idx_geo_targets_country_code
  ON public.google_geo_targets(country_code);

-- Used for parent hierarchy traversal (province → country roll-ups)
CREATE INDEX IF NOT EXISTS idx_geo_targets_parent_id
  ON public.google_geo_targets(parent_id)
  WHERE parent_id IS NOT NULL;

-- Used for type-filtered queries (e.g. only 'District' rows for TR)
CREATE INDEX IF NOT EXISTS idx_geo_targets_country_type
  ON public.google_geo_targets(country_code, target_type);

-- ============================================================
-- 3) RLS
-- ============================================================
ALTER TABLE public.google_geo_targets ENABLE ROW LEVEL SECURITY;

-- Authenticated users (dashboard) can read geo targets for display/filtering
DROP POLICY IF EXISTS "Geo targets: authenticated can read" ON public.google_geo_targets;
CREATE POLICY "Geo targets: authenticated can read"
  ON public.google_geo_targets FOR SELECT
  TO authenticated
  USING (true);

-- Service role can read (used by ingest worker)
-- service_role bypasses RLS by default in Supabase — no explicit policy needed.
-- Adding a permissive policy anyway for defense-in-depth if RLS force is ever enabled.
DROP POLICY IF EXISTS "Geo targets: service_role full access" ON public.google_geo_targets;
CREATE POLICY "Geo targets: service_role full access"
  ON public.google_geo_targets FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Explicitly deny INSERT/UPDATE/DELETE for authenticated users
-- (the default deny from RLS + SELECT-only policy is sufficient, but explicit is clearer)
DROP POLICY IF EXISTS "Geo targets: no write for authenticated" ON public.google_geo_targets;
CREATE POLICY "Geo targets: no write for authenticated"
  ON public.google_geo_targets FOR INSERT
  TO authenticated
  WITH CHECK (false);

COMMIT;
