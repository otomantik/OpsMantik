-- Migration: GO1 — Sales/Bounty ("Casino Kasa") foundation
-- Date: 2026-01-30
-- Purpose: Add sale_amount, estimated_value, currency on calls; config on sites.
-- RLS: Restrict calls UPDATE to allowed fields only; allow owners/admin to update sites.config.

BEGIN;

-- ============================================
-- 1) public.calls: sale/estimate + currency
-- ============================================
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS sale_amount numeric,
  ADD COLUMN IF NOT EXISTS estimated_value numeric,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'TRY';

ALTER TABLE public.calls
  ADD CONSTRAINT calls_sale_amount_non_negative
  CHECK (sale_amount IS NULL OR sale_amount >= 0);

ALTER TABLE public.calls
  ADD CONSTRAINT calls_estimated_value_non_negative
  CHECK (estimated_value IS NULL OR estimated_value >= 0);

COMMENT ON COLUMN public.calls.sale_amount IS 'Actual sale amount (Casino Kasa / bounty).';
COMMENT ON COLUMN public.calls.estimated_value IS 'Estimated value for bounty chip.';
COMMENT ON COLUMN public.calls.currency IS 'Currency code (e.g. TRY).';

-- Optional: updated_at + trigger (sites already has updated_at; calls gets same pattern)
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION public.calls_updated_at_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calls_set_updated_at ON public.calls;
CREATE TRIGGER calls_set_updated_at
  BEFORE UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.calls_updated_at_trigger();

-- ============================================
-- 2) public.sites: config jsonb (bounty chips etc.)
-- ============================================
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.sites.config IS 'Per-site config: bounty chip values, UI knobs, etc.';

-- ============================================
-- 3) RLS: Restrict calls UPDATE to allowed fields only
-- ============================================
-- Allowed for authenticated site owners/editors: sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, note (and updated_at by trigger).
-- Enforce via trigger so full-row updates are rejected for non-service_role.
CREATE OR REPLACE FUNCTION public.calls_enforce_update_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Allow only these columns to differ from OLD: sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, note, lead_score, oci_status, oci_status_updated_at (and updated_at set by other trigger)
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.site_id IS DISTINCT FROM NEW.site_id
     OR OLD.phone_number IS DISTINCT FROM NEW.phone_number
     OR OLD.matched_session_id IS DISTINCT FROM NEW.matched_session_id
     OR OLD.matched_fingerprint IS DISTINCT FROM NEW.matched_fingerprint
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.intent_page_url IS DISTINCT FROM NEW.intent_page_url
     OR OLD.click_id IS DISTINCT FROM NEW.click_id
     OR OLD.source IS DISTINCT FROM NEW.source
     OR OLD.intent_action IS DISTINCT FROM NEW.intent_action
     OR OLD.intent_target IS DISTINCT FROM NEW.intent_target
     OR OLD.intent_stamp IS DISTINCT FROM NEW.intent_stamp
     OR OLD.oci_uploaded_at IS DISTINCT FROM NEW.oci_uploaded_at
     OR OLD.oci_matched_at IS DISTINCT FROM NEW.oci_matched_at
     OR OLD.oci_batch_id IS DISTINCT FROM NEW.oci_batch_id
     OR OLD.oci_error IS DISTINCT FROM NEW.oci_error
  THEN
    RAISE EXCEPTION 'calls: only sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, note, lead_score, oci_status, oci_status_updated_at are updatable by app'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calls_enforce_update_columns ON public.calls;
CREATE TRIGGER calls_enforce_update_columns
  BEFORE UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.calls_enforce_update_columns();

COMMENT ON FUNCTION public.calls_enforce_update_columns() IS 'RLS helper: only allowed call fields updatable by authenticated users; service_role can update any column.';

-- ============================================
-- 4) RLS: Admins can UPDATE sites (for config)
-- ============================================
-- Owners already have "Users can update their own sites". Add policy so admins can update any site (e.g. config).
DROP POLICY IF EXISTS "Admins can update sites" ON public.sites;
CREATE POLICY "Admins can update sites"
  ON public.sites FOR UPDATE
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMIT;
