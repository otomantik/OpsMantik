-- SQL Migration: rebuild_call_projection RPC
-- Phase Elite: Industrial Grade Funnel Reducer
-- Atomically rebuilds call_funnel_projection from call_funnel_ledger.

CREATE OR REPLACE FUNCTION public.rebuild_call_projection(
  p_call_id UUID,
  p_site_id UUID
) RETURNS VOID AS $$
DECLARE
  v_highest_stage TEXT := 'V2';
  v_v2_at TIMESTAMPTZ := NULL;
  v_v3_at TIMESTAMPTZ := NULL;
  v_v4_at TIMESTAMPTZ := NULL;
  v_v5_at TIMESTAMPTZ := NULL;
  v_v2_source TEXT := NULL;
  v_value_cents INT := NULL;
  v_currency TEXT := NULL;
  v_completeness TEXT := 'incomplete';
  v_export_status TEXT := 'NOT_READY';
  v_row RECORD;
BEGIN
  -- 1. Acquire FOR UPDATE lock on the projection row (if exists) or use a sit-id lock to prevent concurrent runs
  -- Actually, the ledger is the source of truth. We lock the ledger rows for this call.
  PERFORM 1 FROM public.call_funnel_ledger 
  WHERE call_id = p_call_id AND site_id = p_site_id
  FOR UPDATE;

  -- 2. Iterate through ordered ledger events
  FOR v_row IN (
    SELECT event_type, occurred_at, payload
    FROM public.call_funnel_ledger
    WHERE call_id = p_call_id AND site_id = p_site_id
    ORDER BY occurred_at ASC, ingested_at ASC, created_at ASC, id ASC
  ) LOOP
    -- V2 logic
    IF v_row.event_type IN ('V2_CONTACT', 'V2_SYNTHETIC') THEN
      v_v2_at := v_row.occurred_at;
      v_v2_source := CASE WHEN v_row.event_type = 'V2_SYNTHETIC' THEN 'SYNTHETIC' ELSE 'REAL' END;
    END IF;

    -- V3 logic
    IF v_row.event_type = 'V3_QUALIFIED' THEN
      v_v3_at := v_row.occurred_at;
      IF v_highest_stage IN ('V2') THEN v_highest_stage := 'V3'; END IF;
    END IF;

    -- V4 logic
    IF v_row.event_type = 'V4_INTENT' THEN
      v_v4_at := v_row.occurred_at;
      IF v_highest_stage IN ('V2', 'V3') THEN v_highest_stage := 'V4'; END IF;
    END IF;

    -- V5 logic
    IF v_row.event_type = 'V5_SEALED' THEN
      v_v5_at := v_row.occurred_at;
      v_highest_stage := 'V5';
      -- Extract value/currency from payload
      IF v_row.payload ? 'value_cents' THEN
        v_value_cents := (v_row.payload->>'value_cents')::INT;
      END IF;
      IF v_row.payload ? 'currency' THEN
        v_currency := v_row.payload->>'currency';
      END IF;
    END IF;
  END LOOP;

  -- 3. Calculate completeness and export status
  IF v_v5_at IS NOT NULL AND v_v2_at IS NOT NULL AND v_v3_at IS NOT NULL AND v_v4_at IS NOT NULL THEN
    v_completeness := 'complete';
  ELSIF v_v2_at IS NOT NULL THEN
    v_completeness := 'partial';
  END IF;

  IF v_completeness = 'complete' THEN
    v_export_status := 'READY';
  END IF;

  -- 4. Validation Guards (Industrial Pro-tip)
  IF v_value_cents < 0 THEN v_value_cents := 0; END IF;

  -- 5. Upsert Projection
  INSERT INTO public.call_funnel_projection (
    call_id,
    site_id,
    highest_stage,
    current_stage,
    v2_at,
    v3_at,
    v4_at,
    v5_at,
    v2_source,
    funnel_completeness,
    export_status,
    value_cents,
    currency,
    updated_at
  )
  VALUES (
    p_call_id,
    p_site_id,
    v_highest_stage,
    CASE WHEN v_v5_at IS NOT NULL THEN 'V5' ELSE 'V2' END,
    v_v2_at,
    v_v3_at,
    v_v4_at,
    v_v5_at,
    v_v2_source,
    v_completeness,
    v_export_status,
    v_value_cents,
    v_currency,
    now()
  )
  ON CONFLICT (call_id) DO UPDATE SET
    highest_stage = EXCLUDED.highest_stage,
    current_stage = EXCLUDED.current_stage,
    v2_at = EXCLUDED.v2_at,
    v3_at = EXCLUDED.v3_at,
    v4_at = EXCLUDED.v4_at,
    v5_at = EXCLUDED.v5_at,
    v2_source = EXCLUDED.v2_source,
    funnel_completeness = EXCLUDED.funnel_completeness,
    export_status = EXCLUDED.export_status,
    value_cents = EXCLUDED.value_cents,
    currency = EXCLUDED.currency,
    updated_at = EXCLUDED.updated_at;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
