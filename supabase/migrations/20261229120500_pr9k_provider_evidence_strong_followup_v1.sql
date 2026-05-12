-- PR-9K follow-up (PR-E): strong provider evidence = API-style request id (UUID / customers/...).
-- Non-empty provider_ref alone does not exclude script-bulk-unconfirmed requeue candidates.

BEGIN;

CREATE OR REPLACE FUNCTION public.pr9k_provider_evidence_strong_v1(p_provider_request_id text)
RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO public
  AS $$
  SELECT
    coalesce(nullif(trim(p_provider_request_id), ''), '') <> ''
    AND (
      lower(trim(p_provider_request_id)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR lower(trim(p_provider_request_id)) LIKE 'customers/%'
    );
$$;

COMMENT ON FUNCTION public.pr9k_provider_evidence_strong_v1(text) IS
  'PR-9K PR-E: API-lane provider_request_id shapes only; script lane refs are not strong confirmation.';

ALTER FUNCTION public.pr9k_provider_evidence_strong_v1(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pr9k_provider_evidence_strong_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pr9k_provider_evidence_strong_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.pr9k_provider_evidence_strong_v1(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pr9k_provider_evidence_strong_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.pr9k_unconfirmed_script_completed_candidates_v1(
  p_site_id uuid,
  p_site_public_id text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_export_run_id text,
  p_incident_key text,
  p_include_actions text[] DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO public
  AS $$
DECLARE
  v_pub text;
  v_ws timestamptz;
  v_we timestamptz;
  v_run text;
  v_detail text;
  v_incident text := nullif(trim(COALESCE(p_incident_key, '')), '');
  v_actions text[] := CASE
    WHEN p_include_actions IS NULL THEN NULL::text[]
    WHEN cardinality(p_include_actions) = 0 THEN NULL::text[]
    ELSE p_include_actions
  END;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied',
      DETAIL = 'pr9k_unconfirmed_script_completed_candidates_v1 may only be called by service_role',
      ERRCODE = 'P0001';
  END IF;

  IF p_site_id IS NULL OR p_site_public_id IS NULL OR length(trim(p_site_public_id)) = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'decision_label', 'PR9K_SELECTOR_CONFIG_MISSING',
      'detail', 'missing_site_or_public_id'
    );
  END IF;

  SELECT lower(trim(s.public_id))
  INTO v_pub
  FROM public.sites AS s
  WHERE s.id = p_site_id
  LIMIT 1;

  IF v_pub IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'decision_label', 'PR9K_SELECTOR_CONFIG_MISSING',
      'detail', 'site_not_found'
    );
  END IF;

  IF v_pub <> lower(trim(p_site_public_id)) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'decision_label', 'PR9K_SELECTOR_CONFIG_MISSING',
      'detail', 'site_public_id_mismatch'
    );
  END IF;

  SELECT w.window_start, w.window_end, w.export_run_id, w.detail
  INTO v_ws, v_we, v_run, v_detail
  FROM public.pr9k_resolve_incident_window_v1(p_site_id, p_window_start, p_window_end, p_export_run_id) AS w;

  IF v_detail IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'decision_label', 'PR9K_SELECTOR_CONFIG_MISSING',
      'detail', v_detail
    );
  END IF;

  RETURN (
    WITH base AS (
      SELECT
        q.id AS queue_id,
        q.action,
        CASE
          WHEN coalesce(nullif(trim(q.gclid), ''), '') <> '' THEN 'gclid'
          WHEN coalesce(nullif(trim(q.wbraid), ''), '') <> '' THEN 'wbraid'
          WHEN coalesce(nullif(trim(q.gbraid), ''), '') <> '' THEN 'gbraid'
          ELSE 'none'
        END AS click_kind,
        (
          length(regexp_replace(lower(coalesce(q.payload->>'hashed_phone_number', '')), '[^0-9a-f]', '', 'g')) = 64
        ) AS hashed_phone_present,
        (
          coalesce(nullif(trim(q.gclid), ''), '') <> ''
          OR coalesce(nullif(trim(q.wbraid), ''), '') <> ''
          OR coalesce(nullif(trim(q.gbraid), ''), '') <> ''
        ) AS exportable,
        public.pr9k_provider_evidence_strong_v1(coalesce(q.provider_request_id, '')) AS provider_evidence_strong,
        (
          v_incident IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.oci_operator_requeue_audit AS a
            WHERE a.site_id = p_site_id
              AND a.queue_id = q.id
              AND a.incident_key = v_incident
          )
        ) AS already_requeued_for_incident
      FROM public.offline_conversion_queue AS q
      WHERE q.site_id = p_site_id
        AND q.status = 'COMPLETED'
        AND (v_actions IS NULL OR q.action = ANY (v_actions))
    ),
    script_window AS (
      SELECT
        b.queue_id,
        b.action,
        b.click_kind,
        b.hashed_phone_present,
        b.exportable,
        b.provider_evidence_strong,
        b.already_requeued_for_incident,
        EXISTS (
          SELECT 1
          FROM public.oci_queue_transitions AS tc
          WHERE tc.queue_id = b.queue_id
            AND tc.new_status = 'COMPLETED'
            AND tc.actor = 'SCRIPT'
            AND tc.created_at >= v_ws
            AND tc.created_at < v_we
            AND EXISTS (
              SELECT 1
              FROM public.oci_queue_transitions AS tp
              WHERE tp.queue_id = b.queue_id
                AND tp.new_status = 'PROCESSING'
                AND tp.actor = 'SCRIPT'
                AND tp.created_at < tc.created_at
            )
        ) AS script_lineage_ok
      FROM base AS b
    ),
    evaluated AS (
      SELECT
        sw.queue_id,
        sw.action,
        sw.click_kind,
        sw.hashed_phone_present,
        sw.exportable,
        CASE
          WHEN sw.provider_evidence_strong THEN 'provider_confirmation_evidence_strong'
          WHEN sw.already_requeued_for_incident THEN 'already_requeued_for_incident'
          WHEN NOT sw.script_lineage_ok THEN 'missing_script_processing_to_completed_lineage_in_window'
          WHEN NOT sw.exportable THEN 'not_exportable_no_click_id'
          ELSE NULL::text
        END AS exclude_reason
      FROM script_window AS sw
    ),
    eligible AS (
      SELECT * FROM evaluated WHERE exclude_reason IS NULL
    ),
    ineligible AS (
      SELECT * FROM evaluated WHERE exclude_reason IS NOT NULL
    ),
    by_action AS (
      SELECT e.action AS k, count(*)::int AS c
      FROM eligible AS e
      GROUP BY e.action
    ),
    by_click AS (
      SELECT e.click_kind AS k, count(*)::int AS c
      FROM eligible AS e
      GROUP BY e.click_kind
    )
    SELECT jsonb_build_object(
      'ok', true,
      'site_id', p_site_id,
      'window_start', v_ws,
      'window_end', v_we,
      'export_run_id', to_jsonb(v_run),
      'incident_key_filter', to_jsonb(v_incident),
      'candidates', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'queue_id', e.queue_id,
            'action', e.action,
            'click_kind', e.click_kind,
            'hashed_phone_present', e.hashed_phone_present,
            'exportable', e.exportable,
            'eligible', true,
            'exclude_reason', null
          )
          ORDER BY e.queue_id
        )
        FROM eligible AS e
      ), '[]'::jsonb),
      'ineligible_sample', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'queue_id', i.queue_id,
            'exclude_reason', i.exclude_reason
          )
          ORDER BY i.queue_id
        )
        FROM (
          SELECT * FROM ineligible ORDER BY queue_id LIMIT 50
        ) AS i
      ), '[]'::jsonb),
      'counts', jsonb_build_object(
        'eligible', (SELECT count(*)::int FROM eligible),
        'ineligible', (SELECT count(*)::int FROM ineligible),
        'by_action', coalesce((SELECT jsonb_object_agg(k, c) FROM by_action), '{}'::jsonb),
        'by_click_kind', coalesce((SELECT jsonb_object_agg(k, c) FROM by_click), '{}'::jsonb),
        'hashed_phone_present_eligible', (SELECT count(*)::int FROM eligible WHERE hashed_phone_present),
        'hashed_phone_absent_eligible', (SELECT count(*)::int FROM eligible WHERE NOT hashed_phone_present)
      ),
      'decision_label', CASE
        WHEN (SELECT count(*) FROM eligible) > 0 THEN 'PR9K_REQUEUE_CANDIDATES_FOUND'
        ELSE 'PR9K_NO_REQUEUE_CANDIDATES'
      END,
      'selector_decision_label', 'PR9K_SELECTOR_READY'
    )
  );
END;
$$;

ALTER FUNCTION public.pr9k_unconfirmed_script_completed_candidates_v1(uuid, text, timestamptz, timestamptz, text, text, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pr9k_unconfirmed_script_completed_candidates_v1(uuid, text, timestamptz, timestamptz, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pr9k_unconfirmed_script_completed_candidates_v1(uuid, text, timestamptz, timestamptz, text, text, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.pr9k_unconfirmed_script_completed_candidates_v1(uuid, text, timestamptz, timestamptz, text, text, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pr9k_unconfirmed_script_completed_candidates_v1(uuid, text, timestamptz, timestamptz, text, text, text[]) TO service_role;


CREATE OR REPLACE FUNCTION public.requeue_unconfirmed_script_completed_rows_v1(
  p_site_id uuid,
  p_site_public_id text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_export_run_id text,
  p_queue_ids uuid[],
  p_incident_key text,
  p_allow_non_exportable boolean DEFAULT false,
  p_apply boolean DEFAULT false
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO public
  AS $$
DECLARE
  v_pub text;
  v_ws timestamptz;
  v_we timestamptz;
  v_run text;
  v_detail text;
  v_incident text := nullif(trim(COALESCE(p_incident_key, '')), '');
  v_ids uuid[];
  v_now timestamptz := now();
  v_payload jsonb;
  v_inserted int := 0;
  v_audit int := 0;
  r record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied',
      DETAIL = 'requeue_unconfirmed_script_completed_rows_v1 may only be called by service_role',
      ERRCODE = 'P0001';
  END IF;

  IF v_incident IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INCIDENT_KEY_REQUIRED', 'decision_label', 'PR9K_SELECTOR_CONFIG_MISSING');
  END IF;

  IF p_site_id IS NULL OR p_site_public_id IS NULL OR length(trim(p_site_public_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SITE_CONFIG', 'decision_label', 'PR9K_SELECTOR_CONFIG_MISSING');
  END IF;

  SELECT lower(trim(s.public_id))
  INTO v_pub
  FROM public.sites AS s
  WHERE s.id = p_site_id
  LIMIT 1;

  IF v_pub IS NULL OR v_pub <> lower(trim(p_site_public_id)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SITE_PUBLIC_MISMATCH', 'decision_label', 'PR9K_SELECTOR_CONFIG_MISSING');
  END IF;

  SELECT w.window_start, w.window_end, w.export_run_id, w.detail
  INTO v_ws, v_we, v_run, v_detail
  FROM public.pr9k_resolve_incident_window_v1(p_site_id, p_window_start, p_window_end, p_export_run_id) AS w;

  IF v_detail IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WINDOW', 'detail', v_detail, 'decision_label', 'PR9K_SELECTOR_CONFIG_MISSING');
  END IF;

  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[])
  INTO v_ids
  FROM unnest(coalesce(p_queue_ids, ARRAY[]::uuid[])) AS t(x)
  WHERE x IS NOT NULL;

  IF coalesce(array_length(v_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EMPTY_QUEUE_IDS', 'decision_label', 'PR9K_NO_REQUEUE_CANDIDATES');
  END IF;

  IF (
    SELECT count(*)::int
    FROM public.offline_conversion_queue AS q
    WHERE q.site_id = p_site_id
      AND q.id = ANY (v_ids)
  ) <> coalesce(array_length(v_ids, 1), 0) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'QUEUE_ID_SITE_MISMATCH',
      'decision_label', 'PR9K_REQUEUE_NEEDS_REVIEW',
      'detail', 'one_or_more_queue_ids_missing_or_not_belonging_to_site'
    );
  END IF;

  -- Validate every requested id against the same eligibility rules as the list RPC.
  FOR r IN
    WITH base AS (
      SELECT
        q.id AS queue_id,
        (
          coalesce(nullif(trim(q.gclid), ''), '') <> ''
          OR coalesce(nullif(trim(q.wbraid), ''), '') <> ''
          OR coalesce(nullif(trim(q.gbraid), ''), '') <> ''
        ) AS exportable,
        public.pr9k_provider_evidence_strong_v1(coalesce(q.provider_request_id, '')) AS provider_evidence_strong,
        EXISTS (
          SELECT 1
          FROM public.oci_operator_requeue_audit AS a
          WHERE a.site_id = p_site_id
            AND a.queue_id = q.id
            AND a.incident_key = v_incident
        ) AS already_audited
      FROM public.offline_conversion_queue AS q
      WHERE q.site_id = p_site_id
        AND q.id = ANY (v_ids)
    ),
    script_window AS (
      SELECT
        b.queue_id,
        b.exportable,
        b.provider_evidence_strong,
        b.already_audited,
        (SELECT q.status FROM public.offline_conversion_queue AS q WHERE q.id = b.queue_id) AS current_status,
        EXISTS (
          SELECT 1
          FROM public.oci_queue_transitions AS tc
          WHERE tc.queue_id = b.queue_id
            AND tc.new_status = 'COMPLETED'
            AND tc.actor = 'SCRIPT'
            AND tc.created_at >= v_ws
            AND tc.created_at < v_we
            AND EXISTS (
              SELECT 1
              FROM public.oci_queue_transitions AS tp
              WHERE tp.queue_id = b.queue_id
                AND tp.new_status = 'PROCESSING'
                AND tp.actor = 'SCRIPT'
                AND tp.created_at < tc.created_at
            )
        ) AS script_lineage_ok
      FROM base AS b
    )
    SELECT
      sw.queue_id,
      sw.current_status,
      sw.exportable,
      sw.provider_evidence_strong,
      sw.already_audited,
      sw.script_lineage_ok,
      CASE
        WHEN sw.current_status IS DISTINCT FROM 'COMPLETED' THEN 'not_completed_current_status'
        WHEN sw.already_audited THEN 'already_requeued_idempotent'
        WHEN sw.provider_evidence_strong THEN 'provider_confirmation_evidence_strong'
        WHEN NOT sw.script_lineage_ok THEN 'missing_script_lineage_in_window'
        WHEN NOT sw.exportable AND NOT coalesce(p_allow_non_exportable, false) THEN 'not_exportable_blocked'
        ELSE NULL::text
      END AS reject_reason
    FROM script_window AS sw
  LOOP
    IF r.reject_reason IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'VALIDATION_FAILED',
        'decision_label', 'PR9K_REQUEUE_NEEDS_REVIEW',
        'failed_queue_id', r.queue_id,
        'reject_reason', r.reject_reason
      );
    END IF;
  END LOOP;

  IF NOT coalesce(p_apply, false) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'decision_label', 'PR9K_REQUEUE_DRY_RUN_READY',
      'would_requeue', coalesce(array_length(v_ids, 1), 0),
      'window_start', v_ws,
      'window_end', v_we,
      'export_run_id', to_jsonb(v_run),
      'incident_key', v_incident
    );
  END IF;

  PERFORM set_config('opsmantik.pr9k_operator_requeue', 'on', true);
  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  v_payload := jsonb_build_object(
    'next_retry_at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'provider_error_category', 'OPERATOR_REQUEUE',
    'provider_error_code', 'GOOGLE_ADS_SCRIPT_UNCONFIRMED_REQUEUE',
    'last_error', 'GOOGLE_ADS_SCRIPT_BULK_UPLOAD_UNCONFIRMED_REQUEUE',
    'clear_fields', jsonb_build_array(
      'uploaded_at',
      'claimed_at',
      'provider_request_id',
      'provider_ref'
    ),
    'pr9k_incident_key', v_incident,
    'pr9k_window_start', to_char(v_ws AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'pr9k_window_end', to_char(v_we AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'pr9k_export_run_id', v_run,
    'pr9k_reason', 'GOOGLE_ADS_SCRIPT_BULK_UPLOAD_UNCONFIRMED_REQUEUE'
  );

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    'RETRY',
    'MANUAL',
    v_now,
    v_payload,
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY (v_ids)
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_ids);

  INSERT INTO public.oci_operator_requeue_audit (
    site_id,
    queue_id,
    previous_status,
    new_status,
    reason_code,
    incident_key,
    actor,
    metadata
  )
  SELECT
    p_site_id,
    q.id,
    'COMPLETED',
    'RETRY',
    'GOOGLE_ADS_SCRIPT_BULK_UPLOAD_UNCONFIRMED_REQUEUE',
    v_incident,
    'operator_tool',
    jsonb_build_object(
      'source', 'PR9K',
      'export_run_id', v_run,
      'window_start', v_ws,
      'window_end', v_we
    )
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY (v_ids)
  ON CONFLICT ON CONSTRAINT oci_operator_requeue_audit_unique_per_incident DO NOTHING;

  GET DIAGNOSTICS v_audit = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'decision_label', 'PR9K_REQUEUE_APPLIED',
    'transitions_inserted', v_inserted,
    'audit_rows_inserted', v_audit,
    'queue_ids', to_jsonb(v_ids),
    'window_start', v_ws,
    'window_end', v_we,
    'export_run_id', to_jsonb(v_run),
    'incident_key', v_incident
  );
END;
$$;

ALTER FUNCTION public.requeue_unconfirmed_script_completed_rows_v1(uuid, text, timestamptz, timestamptz, text, uuid[], text, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.requeue_unconfirmed_script_completed_rows_v1(uuid, text, timestamptz, timestamptz, text, uuid[], text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.requeue_unconfirmed_script_completed_rows_v1(uuid, text, timestamptz, timestamptz, text, uuid[], text, boolean, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.requeue_unconfirmed_script_completed_rows_v1(uuid, text, timestamptz, timestamptz, text, uuid[], text, boolean, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_unconfirmed_script_completed_rows_v1(uuid, text, timestamptz, timestamptz, text, uuid[], text, boolean, boolean) TO service_role;

COMMIT;

