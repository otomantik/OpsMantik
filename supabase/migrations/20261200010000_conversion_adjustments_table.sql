-- ─────────────────────────────────────────────────────────────────────────────
-- Modül 1: Conversion Adjustments Table
--
-- Stores RETRACTION and RESTATEMENT requests for previously exported V5_SEAL
-- conversions. Adjustments are picked up by /api/oci/google-ads-export and
-- uploaded to Google Ads via AdsApp.offlineConversionAdjustments().
--
-- Key invariant: order_id in this table MUST match the original conversion's
-- orderId (stable sha256 hash). Because buildStableOrderId() excludes
-- valueCents, the orderId remains constant even after value changes.
--
-- Lifecycle: PENDING → PROCESSING (claimed by export) → COMPLETED / FAILED
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.conversion_adjustments (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                 uuid        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  -- orderId of the original conversion (must be stable sha256 from buildStableOrderId)
  order_id                text        NOT NULL,

  -- Back-reference to the original queue row (optional but useful for auditing)
  original_queue_id       uuid        REFERENCES public.offline_conversion_queue(id) ON DELETE SET NULL,

  -- Adjustment type
  adjustment_type         text        NOT NULL CHECK (adjustment_type IN ('RETRACTION', 'RESTATEMENT')),

  -- Value logging (not used for orderId — orderId is immutable)
  original_value_cents    bigint,                  -- Original exported value (for auditing)
  new_value_cents         bigint,                  -- RESTATEMENT only; NULL for RETRACTION

  -- Human-readable reason (e.g. "Customer cancelled order", "Partial refund")
  reason                  text,

  -- Processing state
  status                  text        NOT NULL DEFAULT 'PENDING'
                                      CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  processed_at            timestamptz,
  last_error              text,

  -- Google Ads target: which action and channel does this affect?
  conversion_action_name  text        NOT NULL,
  channel                 text        NOT NULL DEFAULT 'phone'
                                      CHECK (channel IN ('phone', 'whatsapp', 'form', 'ecommerce'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Primary sweep: find PENDING adjustments for a site
CREATE INDEX IF NOT EXISTS idx_conversion_adjustments_site_status
  ON public.conversion_adjustments (site_id, status);

-- orderId lookup: quickly find if an orderId already has a pending adjustment
CREATE INDEX IF NOT EXISTS idx_conversion_adjustments_order_id
  ON public.conversion_adjustments (order_id);

-- Retention / cleanup: find old COMPLETED records for archival
CREATE INDEX IF NOT EXISTS idx_conversion_adjustments_created_at
  ON public.conversion_adjustments (created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_conversion_adjustments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversion_adjustments_updated_at ON public.conversion_adjustments;
CREATE TRIGGER trg_conversion_adjustments_updated_at
  BEFORE UPDATE ON public.conversion_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_conversion_adjustments_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.conversion_adjustments ENABLE ROW LEVEL SECURITY;

-- Service role (server-side code, admin client): full access
CREATE POLICY "service_role_full_access_conversion_adjustments"
  ON public.conversion_adjustments
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: can only see their own site's adjustments
CREATE POLICY "site_members_read_conversion_adjustments"
  ON public.conversion_adjustments
  FOR SELECT
  TO authenticated
  USING (
    site_id IN (
      SELECT site_id FROM public.site_members
      WHERE user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.conversion_adjustments IS
  'OCI Modül 1: Conversion adjustments (RETRACTION/RESTATEMENT) for previously exported V5_SEAL conversions. Uploaded to Google Ads via AdsApp.offlineConversionAdjustments().';

COMMENT ON COLUMN public.conversion_adjustments.order_id IS
  'sha256(ns|clickId|action_name|YYYY-MM-DD) — must match original conversion orderId exactly. Google Ads uses this to find and update/retract the original record.';

COMMENT ON COLUMN public.conversion_adjustments.adjustment_type IS
  'RETRACTION: fully remove the conversion (e.g. cancelled order). RESTATEMENT: update the conversion value (e.g. partial refund).';

COMMENT ON COLUMN public.conversion_adjustments.new_value_cents IS
  'Only set for RESTATEMENT. For RETRACTION, leave null. Google Ads will replace the original value with this one.';
