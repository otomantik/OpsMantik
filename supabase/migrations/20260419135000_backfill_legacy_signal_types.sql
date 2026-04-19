-- 20260419135000_backfill_legacy_signal_types.sql
--
-- Phase 3 prerequisite: backfill legacy `marketing_signals.signal_type`
-- values to the canonical set before the dual-write CHECK expansion in
-- 20260419140000. Production databases that were seeded before the V-stage
-- → canonical rename still carry values like `V2_PULSE`, `V3_ENGAGE`,
-- `V4_INTENT`, `V5_SEAL` — these would trip the CHECK in 20260419140000
-- and block the entire Phase 3 rollout.
--
-- Mapping (historical):
--   V2_PULSE   → junk        (low-intent pulse signals were effectively junk)
--   V2_CONTACT → gorusuldu   (V2 contact == spoke-to-customer intent)
--   V3_ENGAGE  → gorusuldu   (engagement = contacted in canonical)
--   V3_QUALIFIED → teklif    (qualified meeting mapped to offer stage)
--   V4_INTENT  → teklif      (explicit offer intent)
--   V5_SEAL    → satis       (seal == won in the original Turkish cutover)
--   pageview / sealed / ROUTED_BY_LCV: also mapped defensively.
--
-- Any remaining non-canonical value after this migration is mapped to
-- 'junk' so the subsequent CHECK can be added without rejection.
--
-- Idempotency: each UPDATE is guarded by a WHERE filter on the specific
-- legacy literal; re-running is a no-op on an already-canonical table.

BEGIN;

-- Disable the append-only trigger briefly so we can rewrite historical
-- rows without tripping its "no mutation after insert" guard.
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

-- Known legacy mappings.
UPDATE public.marketing_signals SET signal_type = 'junk'      WHERE signal_type = 'V2_PULSE';
UPDATE public.marketing_signals SET signal_type = 'gorusuldu' WHERE signal_type = 'V2_CONTACT';
UPDATE public.marketing_signals SET signal_type = 'gorusuldu' WHERE signal_type = 'V3_ENGAGE';
UPDATE public.marketing_signals SET signal_type = 'teklif'    WHERE signal_type = 'V3_QUALIFIED';
UPDATE public.marketing_signals SET signal_type = 'teklif'    WHERE signal_type = 'V4_INTENT';
UPDATE public.marketing_signals SET signal_type = 'satis'     WHERE signal_type = 'V5_SEAL';

-- Defensive cleanup for values seen in ad-hoc prod traffic.
UPDATE public.marketing_signals SET signal_type = 'junk'      WHERE signal_type = 'pageview';
UPDATE public.marketing_signals SET signal_type = 'satis'     WHERE signal_type = 'sealed';
UPDATE public.marketing_signals SET signal_type = 'gorusuldu' WHERE signal_type = 'ROUTED_BY_LCV';

-- Same cleanup for the companion column.
UPDATE public.marketing_signals SET optimization_stage = 'junk'      WHERE optimization_stage = 'V2_PULSE';
UPDATE public.marketing_signals SET optimization_stage = 'gorusuldu' WHERE optimization_stage = 'V2_CONTACT';
UPDATE public.marketing_signals SET optimization_stage = 'gorusuldu' WHERE optimization_stage = 'V3_ENGAGE';
UPDATE public.marketing_signals SET optimization_stage = 'teklif'    WHERE optimization_stage = 'V3_QUALIFIED';
UPDATE public.marketing_signals SET optimization_stage = 'teklif'    WHERE optimization_stage = 'V4_INTENT';
UPDATE public.marketing_signals SET optimization_stage = 'satis'     WHERE optimization_stage = 'V5_SEAL';
UPDATE public.marketing_signals SET optimization_stage = 'junk'      WHERE optimization_stage = 'pageview';
UPDATE public.marketing_signals SET optimization_stage = 'satis'     WHERE optimization_stage = 'sealed';
UPDATE public.marketing_signals SET optimization_stage = 'gorusuldu' WHERE optimization_stage = 'ROUTED_BY_LCV';

-- Catch-all for anything else. If rows remain that are neither legacy V-stages
-- nor canonical, collapse them to 'junk' so the downstream CHECK can apply.
-- Log what we touched so the audit trail is clear.
DO $$
DECLARE
  v_collapsed_count int;
  v_samples text[];
BEGIN
  SELECT COUNT(*), array_agg(DISTINCT signal_type ORDER BY signal_type)
  INTO v_collapsed_count, v_samples
  FROM public.marketing_signals
  WHERE signal_type IS NOT NULL
    AND signal_type NOT IN ('junk', 'gorusuldu', 'contacted', 'teklif', 'offered', 'satis', 'won');

  IF v_collapsed_count > 0 THEN
    RAISE NOTICE 'Backfill collapsing % non-canonical marketing_signals.signal_type rows to junk. Values: %',
      v_collapsed_count, v_samples;

    UPDATE public.marketing_signals
    SET signal_type = 'junk'
    WHERE signal_type IS NOT NULL
      AND signal_type NOT IN ('junk', 'gorusuldu', 'contacted', 'teklif', 'offered', 'satis', 'won');
  END IF;

  -- Same for optimization_stage (allowed to be NULL, so we only catch non-null non-canonical).
  SELECT COUNT(*), array_agg(DISTINCT optimization_stage ORDER BY optimization_stage)
  INTO v_collapsed_count, v_samples
  FROM public.marketing_signals
  WHERE optimization_stage IS NOT NULL
    AND optimization_stage NOT IN ('junk', 'gorusuldu', 'contacted', 'teklif', 'offered', 'satis', 'won');

  IF v_collapsed_count > 0 THEN
    RAISE NOTICE 'Backfill collapsing % non-canonical marketing_signals.optimization_stage rows to junk. Values: %',
      v_collapsed_count, v_samples;

    UPDATE public.marketing_signals
    SET optimization_stage = 'junk'
    WHERE optimization_stage IS NOT NULL
      AND optimization_stage NOT IN ('junk', 'gorusuldu', 'contacted', 'teklif', 'offered', 'satis', 'won');
  END IF;
END $$;

-- Also normalize calls.optimization_stage and offline_conversion_queue.optimization_stage
-- since their CHECK constraints get rewritten by 20260419140000 too.
UPDATE public.calls SET optimization_stage = 'junk'      WHERE optimization_stage = 'V2_PULSE';
UPDATE public.calls SET optimization_stage = 'gorusuldu' WHERE optimization_stage IN ('V2_CONTACT', 'V3_ENGAGE', 'ROUTED_BY_LCV');
UPDATE public.calls SET optimization_stage = 'teklif'    WHERE optimization_stage IN ('V3_QUALIFIED', 'V4_INTENT');
UPDATE public.calls SET optimization_stage = 'satis'     WHERE optimization_stage IN ('V5_SEAL', 'sealed');
UPDATE public.calls SET optimization_stage = 'junk'      WHERE optimization_stage = 'pageview';

UPDATE public.offline_conversion_queue SET optimization_stage = 'junk'      WHERE optimization_stage = 'V2_PULSE';
UPDATE public.offline_conversion_queue SET optimization_stage = 'gorusuldu' WHERE optimization_stage IN ('V2_CONTACT', 'V3_ENGAGE', 'ROUTED_BY_LCV');
UPDATE public.offline_conversion_queue SET optimization_stage = 'teklif'    WHERE optimization_stage IN ('V3_QUALIFIED', 'V4_INTENT');
UPDATE public.offline_conversion_queue SET optimization_stage = 'satis'     WHERE optimization_stage IN ('V5_SEAL', 'sealed');
UPDATE public.offline_conversion_queue SET optimization_stage = 'junk'      WHERE optimization_stage = 'pageview';

-- call_funnel_projection: current_stage is NOT NULL and highest_stage is nullable.
UPDATE public.call_funnel_projection SET highest_stage = 'junk'      WHERE highest_stage = 'V2_PULSE';
UPDATE public.call_funnel_projection SET highest_stage = 'gorusuldu' WHERE highest_stage IN ('V2_CONTACT', 'V3_ENGAGE', 'ROUTED_BY_LCV');
UPDATE public.call_funnel_projection SET highest_stage = 'teklif'    WHERE highest_stage IN ('V3_QUALIFIED', 'V4_INTENT');
UPDATE public.call_funnel_projection SET highest_stage = 'satis'     WHERE highest_stage IN ('V5_SEAL', 'sealed');
UPDATE public.call_funnel_projection SET highest_stage = 'junk'      WHERE highest_stage = 'pageview';

UPDATE public.call_funnel_projection SET current_stage = 'junk'      WHERE current_stage = 'V2_PULSE';
UPDATE public.call_funnel_projection SET current_stage = 'gorusuldu' WHERE current_stage IN ('V2_CONTACT', 'V3_ENGAGE', 'ROUTED_BY_LCV');
UPDATE public.call_funnel_projection SET current_stage = 'teklif'    WHERE current_stage IN ('V3_QUALIFIED', 'V4_INTENT');
UPDATE public.call_funnel_projection SET current_stage = 'satis'     WHERE current_stage IN ('V5_SEAL', 'sealed');
UPDATE public.call_funnel_projection SET current_stage = 'junk'      WHERE current_stage = 'pageview';

-- Re-enable the append-only trigger.
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

COMMIT;
