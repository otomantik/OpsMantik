-- SQL Migration: rebuild_call_projection RPC
-- Canonical Funnel Reducer
-- Atomically rebuilds call_funnel_projection from call_funnel_ledger.

CREATE OR REPLACE FUNCTION public.rebuild_call_projection(
  p_call_id UUID,
  p_site_id UUID
) RETURNS VOID AS $$
DECLARE
  v_highest_stage TEXT := 'junk';
  v_current_stage TEXT := 'junk';
  v_gorusuldu_at TIMESTAMPTZ := NULL;
  v_teklif_at TIMESTAMPTZ := NULL;
  v_satis_at TIMESTAMPTZ := NULL;
  v_value_cents INT := NULL;
  v_currency TEXT := NULL;
  v_quality_score SMALLINT := NULL;
  v_confidence NUMERIC(3,2) := NULL;
  v_completeness TEXT := 'incomplete';
  v_export_status TEXT := 'NOT_READY';
  v_row RECORD;
BEGIN
  PERFORM 1 FROM public.call_funnel_ledger 
  WHERE call_id = p_call_id AND site_id = p_site_id
  FOR UPDATE;

  FOR v_row IN (
    SELECT event_type, occurred_at, payload
    FROM public.call_funnel_ledger
    WHERE call_id = p_call_id AND site_id = p_site_id
    ORDER BY occurred_at ASC, ingested_at ASC, created_at ASC, id ASC
  ) LOOP
    IF v_row.event_type = 'gorusuldu' THEN
      v_gorusuldu_at := COALESCE(v_gorusuldu_at, v_row.occurred_at);
      v_highest_stage := 'gorusuldu';
      v_current_stage := 'gorusuldu';
    ELSIF v_row.event_type = 'teklif' THEN
      v_teklif_at := COALESCE(v_teklif_at, v_row.occurred_at);
      v_highest_stage := 'teklif';
      v_current_stage := 'teklif';
      IF v_row.payload ? 'quality_score' THEN
        v_quality_score := GREATEST(1, LEAST(5, (v_row.payload->>'quality_score')::SMALLINT));
      END IF;
      IF v_row.payload ? 'confidence' THEN
        v_confidence := GREATEST(0, LEAST(1, (v_row.payload->>'confidence')::NUMERIC(3,2)));
      END IF;
    ELSIF v_row.event_type = 'satis' THEN
      v_satis_at := COALESCE(v_satis_at, v_row.occurred_at);
      v_highest_stage := 'satis';
      v_current_stage := 'satis';
      IF v_row.payload ? 'value_cents' THEN
        v_value_cents := (v_row.payload->>'value_cents')::INT;
      END IF;
      IF v_row.payload ? 'currency' THEN
        v_currency := v_row.payload->>'currency';
      END IF;
    END IF;
  END LOOP;

  IF v_satis_at IS NOT NULL THEN
    v_completeness := 'complete';
    v_export_status := 'READY';
  ELSIF v_teklif_at IS NOT NULL OR v_gorusuldu_at IS NOT NULL THEN
    v_completeness := 'partial';
  END IF;

  IF v_value_cents < 0 THEN v_value_cents := 0; END IF;

  INSERT INTO public.call_funnel_projection (
    call_id,
    site_id,
    highest_stage,
    current_stage,
    gorusuldu_at,
    teklif_at,
    satis_at,
    funnel_completeness,
    export_status,
    quality_score,
    confidence,
    value_cents,
    currency,
    updated_at
  )
  VALUES (
    p_call_id,
    p_site_id,
    v_highest_stage,
    v_current_stage,
    v_gorusuldu_at,
    v_teklif_at,
    v_satis_at,
    v_completeness,
    v_export_status,
    v_quality_score,
    v_confidence,
    v_value_cents,
    v_currency,
    now()
  )
  ON CONFLICT (call_id) DO UPDATE SET
    highest_stage = EXCLUDED.highest_stage,
    current_stage = EXCLUDED.current_stage,
    gorusuldu_at = EXCLUDED.gorusuldu_at,
    teklif_at = EXCLUDED.teklif_at,
    satis_at = EXCLUDED.satis_at,
    funnel_completeness = EXCLUDED.funnel_completeness,
    export_status = EXCLUDED.export_status,
    quality_score = EXCLUDED.quality_score,
    confidence = EXCLUDED.confidence,
    value_cents = EXCLUDED.value_cents,
    currency = EXCLUDED.currency,
    updated_at = EXCLUDED.updated_at;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
