-- 20260419150000_english_only_cutover.sql
--
-- English-Only Cutover (Global Launch)
-- =====================================
--
-- Collapses the dual-write transition introduced in 20260419140000 into an
-- English-only canonical vocabulary.
--
--   gorusuldu → contacted
--   teklif    → offered
--   satis     → won
--   junk      → (unchanged)
--
-- Steps:
--   1. DISABLE stage-bearing CHECK constraints temporarily so the UPDATE
--      passes regardless of mid-flight rows.
--   2. UPDATE all existing rows to the English canonical spelling.
--   3. RE-ADD CHECK constraints with English-only allowed sets.
--   4. UPDATE conversion action names in offline_conversion_queue /
--      outbox_events payloads from OpsMantik_Gorusuldu / _Teklif / _Satis /
--      _Cop_Exclusion to OpsMantik_Contacted / _Offered / _Won / _Junk_Exclusion.
--      (The operator is responsible for creating the matching English
--       conversion actions in each Google Ads account BEFORE the deploy window.
--       If they haven't, the worker's upload will 400 with
--       CONVERSION_ACTION_NOT_FOUND and the outbox will retry idempotently —
--       no data loss.)
--
-- Safety:
--   - The ENUM translation (gorusuldu→contacted etc.) is total: every existing
--     Turkish value has exactly one English target. No information is lost.
--   - The `enforce_append_only_signals` trigger on marketing_signals is briefly
--     disabled around the UPDATE. Without this, updates to `signal_type` /
--     `optimization_stage` on historical rows would be blocked.
--   - Idempotent: can be re-applied; second-run UPDATEs match 0 rows because
--     the TR values are gone.
--
-- Operational prerequisite (EXTERNAL):
--   Before running this migration in a given Google Ads account, the four
--   English conversion actions MUST exist and be active:
--       OpsMantik_Contacted
--       OpsMantik_Offered
--       OpsMantik_Won
--       OpsMantik_Junk_Exclusion
--   (same currency, "Enter a value for each conversion" setting, attribution
--    model, and click-through / engaged-view window as their Turkish predecessors).

BEGIN;

-------------------------------------------------------------------------------
-- 0. Temporarily disable append-only trigger on marketing_signals.
-------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_append_only_signals'
      AND tgrelid = 'public.marketing_signals'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE public.marketing_signals DISABLE TRIGGER enforce_append_only_signals';
  END IF;
END $$;

-------------------------------------------------------------------------------
-- 1. Drop CHECK constraints (dual-write era) before the UPDATE.
--    Some rows might transit through TR → EN; the DROP avoids spurious
--    transient violations.
-------------------------------------------------------------------------------
ALTER TABLE public.marketing_signals         DROP CONSTRAINT IF EXISTS enforce_canonical_signal_type;
ALTER TABLE public.marketing_signals         DROP CONSTRAINT IF EXISTS marketing_signals_optimization_stage_check;
ALTER TABLE public.calls                     DROP CONSTRAINT IF EXISTS calls_optimization_stage_check;
ALTER TABLE public.offline_conversion_queue  DROP CONSTRAINT IF EXISTS offline_conversion_queue_optimization_stage_check;
ALTER TABLE public.call_funnel_ledger        DROP CONSTRAINT IF EXISTS enforce_canonical_event_type;
ALTER TABLE public.call_funnel_projection    DROP CONSTRAINT IF EXISTS enforce_canonical_highest_stage;
ALTER TABLE public.call_funnel_projection    DROP CONSTRAINT IF EXISTS enforce_canonical_current_stage;

-------------------------------------------------------------------------------
-- 2. Translate TR → EN across every stage-bearing column.
-------------------------------------------------------------------------------

-- marketing_signals.signal_type + optimization_stage
UPDATE public.marketing_signals
SET signal_type = CASE signal_type
                    WHEN 'gorusuldu' THEN 'contacted'
                    WHEN 'teklif'    THEN 'offered'
                    WHEN 'satis'     THEN 'won'
                    ELSE signal_type
                  END
WHERE signal_type IN ('gorusuldu', 'teklif', 'satis');

UPDATE public.marketing_signals
SET optimization_stage = CASE optimization_stage
                           WHEN 'gorusuldu' THEN 'contacted'
                           WHEN 'teklif'    THEN 'offered'
                           WHEN 'satis'     THEN 'won'
                           ELSE optimization_stage
                         END
WHERE optimization_stage IN ('gorusuldu', 'teklif', 'satis');

-- calls.optimization_stage
UPDATE public.calls
SET optimization_stage = CASE optimization_stage
                           WHEN 'gorusuldu' THEN 'contacted'
                           WHEN 'teklif'    THEN 'offered'
                           WHEN 'satis'     THEN 'won'
                           ELSE optimization_stage
                         END
WHERE optimization_stage IN ('gorusuldu', 'teklif', 'satis');

-- offline_conversion_queue.optimization_stage
UPDATE public.offline_conversion_queue
SET optimization_stage = CASE optimization_stage
                           WHEN 'gorusuldu' THEN 'contacted'
                           WHEN 'teklif'    THEN 'offered'
                           WHEN 'satis'     THEN 'won'
                           ELSE optimization_stage
                         END
WHERE optimization_stage IN ('gorusuldu', 'teklif', 'satis');

-- call_funnel_ledger.event_type
UPDATE public.call_funnel_ledger
SET event_type = CASE event_type
                   WHEN 'gorusuldu' THEN 'contacted'
                   WHEN 'teklif'    THEN 'offered'
                   WHEN 'satis'     THEN 'won'
                   ELSE event_type
                 END
WHERE event_type IN ('gorusuldu', 'teklif', 'satis');

-- call_funnel_projection.highest_stage + current_stage
UPDATE public.call_funnel_projection
SET highest_stage = CASE highest_stage
                      WHEN 'gorusuldu' THEN 'contacted'
                      WHEN 'teklif'    THEN 'offered'
                      WHEN 'satis'     THEN 'won'
                      ELSE highest_stage
                    END
WHERE highest_stage IN ('gorusuldu', 'teklif', 'satis');

UPDATE public.call_funnel_projection
SET current_stage = CASE current_stage
                      WHEN 'gorusuldu' THEN 'contacted'
                      WHEN 'teklif'    THEN 'offered'
                      WHEN 'satis'     THEN 'won'
                      ELSE current_stage
                    END
WHERE current_stage IN ('gorusuldu', 'teklif', 'satis');

-------------------------------------------------------------------------------
-- 3. Conversion action names in offline_conversion_queue.action
--    and marketing_signals.google_conversion_name.
-------------------------------------------------------------------------------
UPDATE public.offline_conversion_queue
SET action = CASE action
               WHEN 'OpsMantik_Gorusuldu'    THEN 'OpsMantik_Contacted'
               WHEN 'OpsMantik_Teklif'       THEN 'OpsMantik_Offered'
               WHEN 'OpsMantik_Satis'        THEN 'OpsMantik_Won'
               WHEN 'OpsMantik_Cop_Exclusion' THEN 'OpsMantik_Junk_Exclusion'
               ELSE action
             END
WHERE action IN (
  'OpsMantik_Gorusuldu', 'OpsMantik_Teklif', 'OpsMantik_Satis', 'OpsMantik_Cop_Exclusion'
);

-- marketing_signals.google_conversion_name exists in some deploys; defensive.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'marketing_signals'
      AND column_name = 'google_conversion_name'
  ) THEN
    EXECUTE $upd$
      UPDATE public.marketing_signals
      SET google_conversion_name = CASE google_conversion_name
                                     WHEN 'OpsMantik_Gorusuldu'     THEN 'OpsMantik_Contacted'
                                     WHEN 'OpsMantik_Teklif'        THEN 'OpsMantik_Offered'
                                     WHEN 'OpsMantik_Satis'         THEN 'OpsMantik_Won'
                                     WHEN 'OpsMantik_Cop_Exclusion' THEN 'OpsMantik_Junk_Exclusion'
                                     ELSE google_conversion_name
                                   END
      WHERE google_conversion_name IN (
        'OpsMantik_Gorusuldu', 'OpsMantik_Teklif', 'OpsMantik_Satis', 'OpsMantik_Cop_Exclusion'
      );
    $upd$;
  END IF;
END $$;

-------------------------------------------------------------------------------
-- 4. Re-add CHECK constraints as ENGLISH-ONLY.
-------------------------------------------------------------------------------
ALTER TABLE public.marketing_signals
  ADD CONSTRAINT enforce_canonical_signal_type
  CHECK (signal_type IN ('junk', 'contacted', 'offered', 'won'));

ALTER TABLE public.marketing_signals
  ADD CONSTRAINT marketing_signals_optimization_stage_check
  CHECK (optimization_stage IS NULL OR optimization_stage IN ('junk', 'contacted', 'offered', 'won'));

ALTER TABLE public.calls
  ADD CONSTRAINT calls_optimization_stage_check
  CHECK (optimization_stage IS NULL OR optimization_stage IN ('junk', 'contacted', 'offered', 'won'));

ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_optimization_stage_check
  CHECK (optimization_stage IS NULL OR optimization_stage IN ('junk', 'contacted', 'offered', 'won'));

ALTER TABLE public.call_funnel_ledger
  ADD CONSTRAINT enforce_canonical_event_type
  CHECK (event_type IN (
    'junk', 'contacted', 'offered', 'won',
    'V1_PAGEVIEW', 'V2_CONTACT', 'V2_PULSE', 'V2_SYNTHETIC',
    'REPAIR_ATTEMPTED', 'REPAIR_COMPLETED', 'REPAIR_FAILED',
    'SYSTEM_JUNK', 'system_repair'
  ));

ALTER TABLE public.call_funnel_projection
  ADD CONSTRAINT enforce_canonical_highest_stage
  CHECK (highest_stage IS NULL OR highest_stage IN ('junk', 'contacted', 'offered', 'won'));

ALTER TABLE public.call_funnel_projection
  ADD CONSTRAINT enforce_canonical_current_stage
  CHECK (current_stage IN ('junk', 'contacted', 'offered', 'won', 'WAITING_FOR_ATTRIBUTION'));

-------------------------------------------------------------------------------
-- 5. Rename call_funnel_projection stage-timestamp columns + rewrite RPC.
-------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_funnel_projection'
      AND column_name = 'gorusuldu_at'
  ) THEN
    EXECUTE 'ALTER TABLE public.call_funnel_projection RENAME COLUMN gorusuldu_at TO contacted_at';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_funnel_projection'
      AND column_name = 'teklif_at'
  ) THEN
    EXECUTE 'ALTER TABLE public.call_funnel_projection RENAME COLUMN teklif_at TO offered_at';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_funnel_projection'
      AND column_name = 'satis_at'
  ) THEN
    EXECUTE 'ALTER TABLE public.call_funnel_projection RENAME COLUMN satis_at TO won_at';
  END IF;
END $$;

-- Rewrite the reducer RPC against the English columns + event_type values.
CREATE OR REPLACE FUNCTION public.rebuild_call_projection(
  p_call_id UUID,
  p_site_id UUID
) RETURNS VOID AS $$
DECLARE
  v_highest_stage TEXT := 'junk';
  v_current_stage TEXT := 'junk';
  v_contacted_at TIMESTAMPTZ := NULL;
  v_offered_at TIMESTAMPTZ := NULL;
  v_won_at TIMESTAMPTZ := NULL;
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
    IF v_row.event_type = 'contacted' THEN
      v_contacted_at := COALESCE(v_contacted_at, v_row.occurred_at);
      v_highest_stage := 'contacted';
      v_current_stage := 'contacted';
    ELSIF v_row.event_type = 'offered' THEN
      v_offered_at := COALESCE(v_offered_at, v_row.occurred_at);
      v_highest_stage := 'offered';
      v_current_stage := 'offered';
      IF v_row.payload ? 'quality_score' THEN
        v_quality_score := GREATEST(1, LEAST(5, (v_row.payload->>'quality_score')::SMALLINT));
      END IF;
      IF v_row.payload ? 'confidence' THEN
        v_confidence := GREATEST(0, LEAST(1, (v_row.payload->>'confidence')::NUMERIC(3,2)));
      END IF;
    ELSIF v_row.event_type = 'won' THEN
      v_won_at := COALESCE(v_won_at, v_row.occurred_at);
      v_highest_stage := 'won';
      v_current_stage := 'won';
      IF v_row.payload ? 'value_cents' THEN
        v_value_cents := (v_row.payload->>'value_cents')::INT;
      END IF;
      IF v_row.payload ? 'currency' THEN
        v_currency := v_row.payload->>'currency';
      END IF;
    END IF;
  END LOOP;

  IF v_won_at IS NOT NULL THEN
    v_completeness := 'complete';
    v_export_status := 'READY';
  ELSIF v_offered_at IS NOT NULL OR v_contacted_at IS NOT NULL THEN
    v_completeness := 'partial';
  END IF;

  IF v_value_cents < 0 THEN v_value_cents := 0; END IF;

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
    v_contacted_at,
    v_offered_at,
    v_won_at,
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
    contacted_at = EXCLUDED.contacted_at,
    offered_at = EXCLUDED.offered_at,
    won_at = EXCLUDED.won_at,
    funnel_completeness = EXCLUDED.funnel_completeness,
    export_status = EXCLUDED.export_status,
    quality_score = EXCLUDED.quality_score,
    confidence = EXCLUDED.confidence,
    value_cents = EXCLUDED.value_cents,
    currency = EXCLUDED.currency,
    updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-------------------------------------------------------------------------------
-- 6. Re-enable append-only trigger.
-------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_append_only_signals'
      AND tgrelid = 'public.marketing_signals'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE public.marketing_signals ENABLE TRIGGER enforce_append_only_signals';
  END IF;
END $$;

-------------------------------------------------------------------------------
-- 7. Documentation.
-------------------------------------------------------------------------------
COMMENT ON CONSTRAINT enforce_canonical_signal_type ON public.marketing_signals IS
  'Global-launch cutover (20260419150000): English-only canonical stage literals '
  '(junk | contacted | offered | won). Turkish legacy values removed.';

COMMENT ON CONSTRAINT enforce_canonical_highest_stage ON public.call_funnel_projection IS
  'Global-launch cutover (20260419150000): English-only canonical stage literals.';

COMMIT;
