-- Migration: Phase 1 Stamp Package — call intent idempotency
-- Date: 2026-01-28
--
-- Adds:
-- - calls.intent_stamp TEXT (nullable)
-- - calls.intent_action TEXT (nullable)
-- - calls.intent_target TEXT (nullable)
-- - UNIQUE index on (site_id, intent_stamp) WHERE intent_stamp IS NOT NULL
-- - Fallback dedupe index for 10s window checks

BEGIN;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS intent_stamp TEXT,
  ADD COLUMN IF NOT EXISTS intent_action TEXT,
  ADD COLUMN IF NOT EXISTS intent_target TEXT;

COMMENT ON COLUMN public.calls.intent_stamp IS 'Client-generated idempotency stamp for click intents (nullable).';
COMMENT ON COLUMN public.calls.intent_action IS 'Normalized intent action (e.g. phone_call, whatsapp_click) (nullable).';
COMMENT ON COLUMN public.calls.intent_target IS 'Normalized target for dedupe (e.g. +905.. or wa.me/..) (nullable).';

-- DB-level idempotency (preferred)
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_site_intent_stamp_uniq
ON public.calls(site_id, intent_stamp)
WHERE intent_stamp IS NOT NULL;

-- Fallback dedupe support when stamp is missing (10s window query)
CREATE INDEX IF NOT EXISTS idx_calls_intent_fallback_dedupe
ON public.calls(site_id, matched_session_id, intent_action, intent_target, created_at)
WHERE source = 'click' AND (status = 'intent' OR status IS NULL);

COMMIT;

