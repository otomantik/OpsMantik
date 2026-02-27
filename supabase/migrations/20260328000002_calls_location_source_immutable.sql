-- Make calls.location_source immutable (set at insert from GCLID; app users must not change it).

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
  OR OLD.keyword            IS DISTINCT FROM NEW.keyword
  OR OLD.match_type         IS DISTINCT FROM NEW.match_type
  OR OLD.device_model       IS DISTINCT FROM NEW.device_model
  OR OLD.geo_target_id      IS DISTINCT FROM NEW.geo_target_id
  OR OLD.district_name      IS DISTINCT FROM NEW.district_name
  OR OLD.location_source    IS DISTINCT FROM NEW.location_source
  THEN
    RAISE EXCEPTION
      'calls: only sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, cancelled_at, note, lead_score, oci_status, oci_status_updated_at are updatable by app users. Ads enrichment (keyword, match_type, device_model, geo_target_id, district_name, location_source) are immutable after insert.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.calls_enforce_update_columns() IS
'RLS helper: immutable columns for authenticated app users. service_role bypass. Includes ads enrichment and location_source as immutable.';
