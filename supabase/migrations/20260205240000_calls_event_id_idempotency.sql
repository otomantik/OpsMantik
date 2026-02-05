-- Migration: Call-event idempotency via event_id
-- Date: 2026-02-05
--
-- Adds calls.event_id (uuid) + unique constraint per site.

BEGIN;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS event_id uuid;

-- Idempotency: allow at-least-once ingestion without duplicates when event_id is provided.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_site_event_id_uniq
  ON public.calls (site_id, event_id)
  WHERE event_id IS NOT NULL;

COMMIT;

