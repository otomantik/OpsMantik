-- Migration: conversion_adjustments table
-- Part of: OCI Evrensel Export Çerçevesi Enterprise Edition — Modül 1
--
-- Enables RETRACTION and RESTATEMENT of offline conversions that have
-- already been exported to Google Ads.
--
-- Workflow:
--   1. POST /api/oci/adjustments → inserts PENDING row
--   2. GET  /api/oci/google-ads-export → includes adjustments[] block
--   3. Google Ads Script uploads via AdsApp.offlineConversionAdjustments()
--   4. POST /api/oci/ack with adjustmentIds[] → marks COMPLETED
--
-- orderId stability guarantee:
--   The orderId here MUST match the orderId from the original offline_conversion_queue row.
--   Because buildStableOrderId() excludes valueCents, this is guaranteed.

CREATE TABLE IF NOT EXISTS public.conversion_adjustments (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                 uuid        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,

  -- The stable orderId from the original offline_conversion_queue row.
  -- Used by Google Ads to locate and modify the original conversion.
  order_id                text        NOT NULL,

  -- Optional back-reference to the original queue row (for auditing)
  original_queue_id       uuid        REFERENCES offline_conversion_queue(id) ON DELETE SET NULL,

  -- RETRACTION: cancel the conversion entirely (new_value_cents = NULL)
  -- RESTATEMENT: update the conversion value (new_value_cents = new amount)
  adjustment_type         text        NOT NULL
                          CHECK (adjustment_type IN ('RETRACTION', 'RESTATEMENT')),

  -- Original value at time of export (for audit / comparison)
  original_value_cents    bigint,

  -- Only used for RESTATEMENT; must be NULL for RETRACTION
  new_value_cents         bigint,

  -- Human-readable reason (e.g. "Customer cancelled order", "Partial refund")
  reason                  text,

  status                  text        NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),

  created_at              timestamptz NOT NULL DEFAULT now(),
  processed_at            timestamptz,
  last_error              text,

  -- Which Google Ads conversion action this adjustment targets
  conversion_action_name  text        NOT NULL,

  -- Channel that produced the original conversion
  channel                 text        NOT NULL DEFAULT 'phone',

  -- Timestamps for audit trail
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Efficient queries: find pending adjustments per site
CREATE INDEX IF NOT EXISTS idx_conversion_adjustments_site_status
  ON public.conversion_adjustments(site_id, status);

-- Efficient lookups by orderId (for matching to original conversions)
CREATE INDEX IF NOT EXISTS idx_conversion_adjustments_order_id
  ON public.conversion_adjustments(order_id);

-- Audit: find all adjustments for a queue row
CREATE INDEX IF NOT EXISTS idx_conversion_adjustments_queue_id
  ON public.conversion_adjustments(original_queue_id)
  WHERE original_queue_id IS NOT NULL;

-- Constraint: RESTATEMENT must have a new value; RETRACTION must not
ALTER TABLE public.conversion_adjustments
  ADD CONSTRAINT chk_restatement_has_value
    CHECK (
      (adjustment_type = 'RESTATEMENT' AND new_value_cents IS NOT NULL)
      OR (adjustment_type = 'RETRACTION' AND new_value_cents IS NULL)
    );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_conversion_adjustments_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
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
