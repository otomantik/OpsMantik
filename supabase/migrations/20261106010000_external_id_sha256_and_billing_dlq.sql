BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Part 1: Migrate external_id from MD5 to SHA-256
--
-- Background: the original compute_offline_conversion_external_id() used md5().
-- MD5 is cryptographically broken. This migration upgrades the function to
-- use SHA-256 (encode(sha256(fingerprint::bytea), 'hex')), truncated to the
-- first 32 hex characters (128 bits) so values stay under typical index limits.
--
-- WARNING: All existing external_id values will change. The unique partial index
-- is dropped and rebuilt after the backfill. Any in-flight PROCESSING rows will
-- resume with the new SHA-256 external_id on their next re-queue.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1.1: Drop the existing partial unique index (values are about to change)
DROP INDEX IF EXISTS idx_offline_conversion_queue_site_provider_external_id_active;

-- Step 1.2: Replace the compute function with SHA-256
CREATE OR REPLACE FUNCTION public.compute_offline_conversion_external_id(
  p_provider_key text DEFAULT 'google_ads',
  p_action       text DEFAULT 'purchase',
  p_sale_id      uuid DEFAULT NULL,
  p_call_id      uuid DEFAULT NULL,
  p_session_id   uuid DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    'oci_' || left(
      encode(
        sha256(
          (
            lower(COALESCE(NULLIF(btrim(p_provider_key), ''), 'google_ads'))
            || '|'
            || lower(COALESCE(NULLIF(btrim(p_action), ''), 'purchase'))
            || '|'
            || COALESCE(p_sale_id::text, '')
            || '|'
            || COALESCE(p_call_id::text, '')
            || '|'
            || COALESCE(p_session_id::text, '')
          )::bytea
        ),
        'hex'
      ),
      32
    );
$$;

COMMENT ON FUNCTION public.compute_offline_conversion_external_id(text, text, uuid, uuid, uuid) IS
  'Deterministically derives the logical OCI external_id (SHA-256, first 128 bits). '
  'Replaces the previous MD5-based implementation. App-side: computeOfflineConversionExternalId().';

-- Step 1.3: Backfill all existing rows with new SHA-256-based external_id values
UPDATE public.offline_conversion_queue
SET external_id = public.compute_offline_conversion_external_id(
  provider_key,
  action,
  sale_id,
  call_id,
  session_id
)
WHERE provider_key IS NOT NULL OR sale_id IS NOT NULL OR call_id IS NOT NULL OR session_id IS NOT NULL;

-- Step 1.4: Rebuild the unique partial index on the new values
CREATE UNIQUE INDEX idx_offline_conversion_queue_site_provider_external_id_active
  ON public.offline_conversion_queue (site_id, provider_key, external_id)
  WHERE status NOT IN ('VOIDED_BY_REVERSAL', 'COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED', 'FAILED');

COMMENT ON INDEX idx_offline_conversion_queue_site_provider_external_id_active IS
  'Deduplication guard: prevents duplicate active OCI conversions for the same logical identity. '
  'External_id is now SHA-256-based.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Part 2: Billing compensation failures DLQ table
--
-- When the workers/ingest route fails to decrement usage after a processing
-- error, the site's usage counter is permanently inflated by one phantom event.
-- This table records every compensation failure so a cron job can reconcile them.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.billing_compensation_failures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL,
  idempotency_key  text NOT NULL,
  month            text NOT NULL,
  kind             text NOT NULL DEFAULT 'revenue_events',
  failure_type     text NOT NULL, -- 'decrement_rpc' | 'delete_idempotency_key'
  error_message    text,
  qstash_message_id text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      text
);

COMMENT ON TABLE public.billing_compensation_failures IS
  'Records every failed billing compensation so phantom usage increments can be reconciled. '
  'Rows should be processed by /api/cron/billing-compensation-reconcile.';

CREATE INDEX idx_billing_compensation_failures_unresolved
  ON public.billing_compensation_failures (site_id, created_at)
  WHERE resolved_at IS NULL;

COMMIT;
