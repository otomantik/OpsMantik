-- =============================================================================
-- Revenue Kernel: ingest_idempotency billing metadata (proof + analytics)
-- Additive-only, safe to apply at any time.
-- - event_category / event_action / event_label: enables SQL proofs for "karma" billing
-- - billing_reason: explains why row is billable=false (non_billable_system, scroll_depth, rejected_quota, etc.)
-- =============================================================================

BEGIN;

ALTER TABLE public.ingest_idempotency
  ADD COLUMN IF NOT EXISTS event_category text,
  ADD COLUMN IF NOT EXISTS event_action text,
  ADD COLUMN IF NOT EXISTS event_label text,
  ADD COLUMN IF NOT EXISTS billing_reason text;

COMMENT ON COLUMN public.ingest_idempotency.event_category IS
  'Ingest classification: payload.ec (e.g. conversion, interaction, system). For billing proof and audits.';
COMMENT ON COLUMN public.ingest_idempotency.event_action IS
  'Ingest classification: payload.ea (e.g. phone_call, view, scroll_depth, heartbeat). For billing proof and audits.';
COMMENT ON COLUMN public.ingest_idempotency.event_label IS
  'Ingest classification: payload.el (label). Optional.';
COMMENT ON COLUMN public.ingest_idempotency.billing_reason IS
  'Billing reason for billable flag and decisions (e.g. conversion, interaction_view, scroll_depth, system, rejected_quota).';

-- Helpful index for audits / unblock scripts
CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_site_year_month_reason
  ON public.ingest_idempotency(site_id, year_month, billing_reason);

COMMIT;

