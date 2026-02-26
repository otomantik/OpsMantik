-- Migration: Google Ads enrichment columns on calls
-- Date: 2026-02-26
--
-- Purpose: Store hyper-granular Google Ads data captured via ValueTrack parameters
--          ({keyword}, {matchtype}, {device_model}, {loc_physical_ms}) at call-event time.
--
-- Columns added:
--   keyword        - Google Ads matched keyword (e.g. 'diş implant ankara')
--   match_type     - Keyword match type: 'e' (exact) | 'p' (phrase) | 'b' (broad)
--   device_model   - Full device model string (e.g. 'Apple iPhone 15 Pro')
--   geo_target_id  - Raw criteria ID from {loc_physical_ms} (e.g. 1012782)
--   district_name  - Resolved human-readable name (e.g. 'Şişli / İstanbul'), set by ingest worker
--
-- Trigger update:
--   The calls_enforce_update_columns trigger is re-created to allow these new
--   immutable-at-insert columns to be written by service_role without restriction.
--   (service_role already bypasses the trigger via the early-return guard, but the
--    COMMENT is updated for accuracy and a fresh CREATE OR REPLACE ensures any
--    future changes are reflected.)

BEGIN;

-- ============================================================
-- 1) Add ads enrichment columns to calls
-- ============================================================
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS keyword        TEXT,
  ADD COLUMN IF NOT EXISTS match_type     TEXT,
  ADD COLUMN IF NOT EXISTS device_model   TEXT,
  ADD COLUMN IF NOT EXISTS geo_target_id  BIGINT,
  ADD COLUMN IF NOT EXISTS district_name  TEXT;

COMMENT ON COLUMN public.calls.keyword       IS 'Google Ads matched keyword from {keyword} ValueTrack parameter.';
COMMENT ON COLUMN public.calls.match_type    IS 'Keyword match type from {matchtype}: e=exact, p=phrase, b=broad.';
COMMENT ON COLUMN public.calls.device_model  IS 'Full device model string from {device_model} ValueTrack (e.g. Apple iPhone 15 Pro).';
COMMENT ON COLUMN public.calls.geo_target_id IS 'Raw Google Criteria ID from {loc_physical_ms} ValueTrack. FK (soft) to google_geo_targets.criteria_id.';
COMMENT ON COLUMN public.calls.district_name IS 'Human-readable district resolved from geo_target_id at ingest time (e.g. Şişli / İstanbul).';

-- Optional soft FK constraint (not enforced — geo table may be partially seeded)
-- ALTER TABLE public.calls
--   ADD CONSTRAINT fk_calls_geo_target
--   FOREIGN KEY (geo_target_id) REFERENCES public.google_geo_targets(criteria_id)
--   ON DELETE SET NULL NOT VALID;

-- ============================================================
-- 2) Indexes for ads reporting queries
-- ============================================================

-- Geo-based segmentation (e.g. "calls by district")
CREATE INDEX IF NOT EXISTS idx_calls_geo_target_id
  ON public.calls(geo_target_id)
  WHERE geo_target_id IS NOT NULL;

-- Keyword-level performance per site (e.g. "top keywords by call volume")
CREATE INDEX IF NOT EXISTS idx_calls_site_keyword
  ON public.calls(site_id, keyword)
  WHERE keyword IS NOT NULL;

-- Device model segmentation (e.g. "iPhone vs Android call rates")
CREATE INDEX IF NOT EXISTS idx_calls_device_model
  ON public.calls(device_model)
  WHERE device_model IS NOT NULL;

-- ============================================================
-- 3) Update calls_enforce_update_columns trigger
--
--    The new columns (keyword, match_type, device_model, geo_target_id, district_name)
--    are IMMUTABLE after insert — they should NEVER be changed by authenticated app users.
--    So we add them to the "frozen column" guard in the trigger.
--
--    service_role is ALREADY exempt (early-return guard at line 1 of the function).
--    This update is defensive: it documents the new columns as immutable for app users
--    and ensures any future inadvertent UPDATE from app layer is caught.
-- ============================================================
CREATE OR REPLACE FUNCTION public.calls_enforce_update_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- service_role (ingest worker, internal RPCs) can update any column.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Immutable columns: core identity, intent context, OCI tracking, and ads enrichment.
  -- Only these are allowed to differ for authenticated users:
  --   sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by,
  --   cancelled_at, note, lead_score, oci_status, oci_status_updated_at, updated_at (trigger).
  IF OLD.id                 IS DISTINCT FROM NEW.id
  OR OLD.site_id            IS DISTINCT FROM NEW.site_id
  OR OLD.phone_number       IS DISTINCT FROM NEW.phone_number
  OR OLD.matched_session_id IS DISTINCT FROM NEW.matched_session_id
  OR OLD.matched_fingerprint IS DISTINCT FROM NEW.matched_fingerprint
  OR OLD.created_at         IS DISTINCT FROM NEW.created_at
  OR OLD.intent_page_url    IS DISTINCT FROM NEW.intent_page_url
  OR OLD.click_id           IS DISTINCT FROM NEW.click_id
  OR OLD.source             IS DISTINCT FROM NEW.source
  OR OLD.intent_action      IS DISTINCT FROM NEW.intent_action
  OR OLD.intent_target      IS DISTINCT FROM NEW.intent_target
  OR OLD.intent_stamp       IS DISTINCT FROM NEW.intent_stamp
  OR OLD.oci_uploaded_at    IS DISTINCT FROM NEW.oci_uploaded_at
  OR OLD.oci_matched_at     IS DISTINCT FROM NEW.oci_matched_at
  OR OLD.oci_batch_id       IS DISTINCT FROM NEW.oci_batch_id
  OR OLD.oci_error          IS DISTINCT FROM NEW.oci_error
  -- Google Ads enrichment columns (immutable after insert):
  OR OLD.keyword            IS DISTINCT FROM NEW.keyword
  OR OLD.match_type         IS DISTINCT FROM NEW.match_type
  OR OLD.device_model       IS DISTINCT FROM NEW.device_model
  OR OLD.geo_target_id      IS DISTINCT FROM NEW.geo_target_id
  OR OLD.district_name      IS DISTINCT FROM NEW.district_name
  THEN
    RAISE EXCEPTION
      'calls: only sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, cancelled_at, note, lead_score, oci_status, oci_status_updated_at are updatable by app users. Ads enrichment columns (keyword, match_type, device_model, geo_target_id, district_name) are immutable after insert.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.calls_enforce_update_columns() IS
'RLS helper: immutable columns whitelist for authenticated app users. service_role bypass. Includes ads enrichment columns (keyword, match_type, device_model, geo_target_id, district_name) as immutable. Updated 2026-02-26.';

COMMIT;
