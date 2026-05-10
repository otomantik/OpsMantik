-- PR-9H.6: Preserve hashed user identifiers, provider path metadata, and source idempotency
-- for unified intent → offline_conversion_queue journal model.
-- Relaxes session-level single-flight unique so multiple conversion *actions* can be QUEUED per session.

BEGIN;

ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS user_identifiers jsonb,
  ADD COLUMN IF NOT EXISTS provider_path text,
  ADD COLUMN IF NOT EXISTS source_idempotency_key text,
  ADD COLUMN IF NOT EXISTS source_type text;

COMMENT ON COLUMN public.offline_conversion_queue.user_identifiers IS
  'Hashed Enhanced Conversions identifiers only (SHA-256 hex per Google rules). Never raw PII.';
COMMENT ON COLUMN public.offline_conversion_queue.provider_path IS
  'Target upload adapter: google_ads_script_v1 | google_ads_api_click_conversion | google_ads_api_enhanced_conversions_leads';
COMMENT ON COLUMN public.offline_conversion_queue.source_idempotency_key IS
  'Application idempotency key for projection/enqueue (dedupe with partial unique index).';
COMMENT ON COLUMN public.offline_conversion_queue.source_type IS
  'Producer label, e.g. panel_stage, seal_route, outbox, funnel_ledger.';

-- Replace overly strict (site_id, session_id) pending unique with (site_id, session_id, action)
-- so OpsMantik_Contacted / OpsMantik_Offered / OpsMantik_Won can coexist per session.
DROP INDEX IF EXISTS idx_offline_conversion_queue_site_session_pending;

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_conversion_queue_site_session_action_pending
  ON public.offline_conversion_queue (site_id, session_id, action)
  WHERE
    status = ANY (ARRAY['QUEUED'::text, 'RETRY'::text, 'PROCESSING'::text])
    AND session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_conversion_queue_site_provider_source_idempotency
  ON public.offline_conversion_queue (site_id, provider_key, source_idempotency_key)
  WHERE source_idempotency_key IS NOT NULL;

COMMIT;
