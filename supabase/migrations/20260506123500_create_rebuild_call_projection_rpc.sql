BEGIN;

CREATE OR REPLACE FUNCTION public.rebuild_call_projection(
  p_call_id uuid,
  p_site_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_table_exists boolean := to_regclass('public.call_funnel_projection') IS NOT NULL;
  v_contacted_at timestamptz;
  v_offered_at timestamptz;
  v_won_at timestamptz;
  v_highest_stage text := 'junk';
  v_current_stage text := 'junk';
  v_export_status text := 'BLOCKED';
  v_funnel_completeness text := 'incomplete';
BEGIN
  IF p_call_id IS NULL OR p_site_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENTS');
  END IF;

  IF NOT v_table_exists THEN
    RETURN jsonb_build_object('ok', true, 'status', 'skipped_missing_projection_table');
  END IF;

  SELECT c.status
  INTO v_current_stage
  FROM public.calls c
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  LIMIT 1;

  SELECT
    MIN(l.occurred_at) FILTER (WHERE l.event_type = 'contacted'),
    MIN(l.occurred_at) FILTER (WHERE l.event_type = 'offered'),
    MIN(l.occurred_at) FILTER (WHERE l.event_type = 'won')
  INTO v_contacted_at, v_offered_at, v_won_at
  FROM public.call_funnel_ledger l
  WHERE l.call_id = p_call_id
    AND l.site_id = p_site_id;

  IF v_won_at IS NOT NULL THEN
    v_highest_stage := 'won';
  ELSIF v_offered_at IS NOT NULL THEN
    v_highest_stage := 'offered';
  ELSIF v_contacted_at IS NOT NULL THEN
    v_highest_stage := 'contacted';
  END IF;

  IF v_won_at IS NOT NULL THEN
    v_funnel_completeness := 'complete';
    v_export_status := 'READY';
  ELSIF v_offered_at IS NOT NULL OR v_contacted_at IS NOT NULL THEN
    v_funnel_completeness := 'partial';
    v_export_status := 'BLOCKED';
  END IF;

  UPDATE public.call_funnel_projection p
  SET
    highest_stage = v_highest_stage,
    current_stage = COALESCE(v_current_stage, v_highest_stage),
    contacted_at = v_contacted_at,
    offered_at = v_offered_at,
    won_at = v_won_at,
    funnel_completeness = v_funnel_completeness,
    export_status = v_export_status,
    updated_at = now()
  WHERE p.call_id = p_call_id
    AND p.site_id = p_site_id;

  IF NOT FOUND THEN
    INSERT INTO public.call_funnel_projection (
      call_id,
      site_id,
      highest_stage,
      current_stage,
      contacted_at,
      offered_at,
      won_at,
      funnel_completeness,
      export_status,
      updated_at
    )
    VALUES (
      p_call_id,
      p_site_id,
      v_highest_stage,
      COALESCE(v_current_stage, v_highest_stage),
      v_contacted_at,
      v_offered_at,
      v_won_at,
      v_funnel_completeness,
      v_export_status,
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'rebuilt',
    'highest_stage', v_highest_stage,
    'export_status', v_export_status
  );
EXCEPTION
  WHEN undefined_table OR undefined_column THEN
    RETURN jsonb_build_object('ok', true, 'status', 'skipped_projection_schema_drift');
END;
$function$;

REVOKE ALL ON FUNCTION public.rebuild_call_projection(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rebuild_call_projection(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rebuild_call_projection(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_call_projection(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.rebuild_call_projection(uuid, uuid)
IS 'Rebuilds one call_funnel_projection row from call_funnel_ledger/calls when projection table is available. Returns status json.';

COMMIT;
