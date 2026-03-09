-- Lint fix 0011: Set search_path on functions to prevent search_path injection.
-- See: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
-- Uses conditional execution: only alter functions that exist (e.g. get_stats_cards, analyze_gumus_alanlar may be optional).

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname IN (
      'fn_update_last_status_change_at', 'handle_call_status_change', 'utc_year_month',
      'get_stats_cards', 'queue_transition_payload_has_meaningful_patch', 'oci_transition_payload_missing_required',
      'oci_transition_payload_unknown_keys', 'get_url_param', 'validate_date_range', 'analyze_gumus_alanlar_funnel',
      'close_stale_uploaded_conversions', 'is_admin', 'admin_sites_list', 'compute_offline_conversion_external_id',
      'fn_increment_calls_version', 'queue_transition_clear_fields', 'is_ads_session_click_id_only',
      'handle_new_user', 'set_updated_at', 'is_ads_session_input', 'is_ads_session',
      'fn_set_standard_expires_at', 'oci_transition_payload_allowed_keys'
    )
    LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', rec.sig);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped search_path for %: %', rec.sig, SQLERRM;
    END;
  END LOOP;
END $$;
