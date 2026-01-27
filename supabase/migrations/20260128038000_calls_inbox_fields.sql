-- Migration: Live Inbox v1 - lightweight call intent fields
-- Date: 2026-01-28
--
-- Goal: Live Inbox must not require heavy joins.
-- Adds:
-- - calls.intent_page_url: the page where click happened
-- - calls.click_id: best-effort (gclid|wbraid|gbraid) for quick attribution display

BEGIN;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS intent_page_url TEXT,
  ADD COLUMN IF NOT EXISTS click_id TEXT;

COMMENT ON COLUMN public.calls.intent_page_url IS 'Page URL where the click intent occurred (no joins needed).';
COMMENT ON COLUMN public.calls.click_id IS 'Best-effort click id (gclid/wbraid/gbraid) captured at intent time (nullable).';

-- Helpful for time-window inbox queries
CREATE INDEX IF NOT EXISTS idx_calls_site_source_created_at
ON public.calls(site_id, source, created_at DESC);

COMMIT;

