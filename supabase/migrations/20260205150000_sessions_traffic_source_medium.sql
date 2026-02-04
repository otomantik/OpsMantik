-- Add traffic source classification fields to sessions.
-- These are nullable and filled by backend classifier (best-effort).

BEGIN;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS traffic_source text;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS traffic_medium text;

COMMIT;

