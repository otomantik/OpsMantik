-- 20260419138000_backfill_call_funnel_projection.sql
--
-- Phase 3 prerequisite (third pass): backfill legacy
-- `call_funnel_projection.highest_stage` + `current_stage` values that
-- 20260419135000 missed. Runtime evidence from the previous push showed
-- 81 rows in call_funnel_ledger had `V5_SEALED` (note: `ED` suffix) — 135000
-- only mapped `V5_SEAL` (no `ED`). Same gap exists on call_funnel_projection.
--
-- This migration:
--   1. Defensively drops any old narrower CHECKs that might block the backfill
--      (same pattern we needed for call_funnel_ledger in 20260419137000).
--   2. Maps known V-stage variants (including both `V5_SEAL` and `V5_SEALED`).
--   3. Catch-all: any remaining non-canonical value collapses to 'junk' and
--      is logged via RAISE NOTICE so the deploy log captures exactly what
--      was rewritten (same observability pattern as 20260419135000/137000).
--
-- Idempotent: after one successful apply, all values are canonical and
-- re-running is a no-op.

BEGIN;

-- Defensive DROP of any legacy narrower CHECKs. The two candidate names
-- cover both the table-column auto-generated shape and the explicit name.
ALTER TABLE public.call_funnel_projection
  DROP CONSTRAINT IF EXISTS call_funnel_projection_highest_stage_check;

ALTER TABLE public.call_funnel_projection
  DROP CONSTRAINT IF EXISTS call_funnel_projection_current_stage_check;

-- Known legacy mappings for highest_stage.
UPDATE public.call_funnel_projection SET highest_stage = 'junk'      WHERE highest_stage = 'V2_PULSE';
UPDATE public.call_funnel_projection SET highest_stage = 'gorusuldu' WHERE highest_stage IN ('V2_CONTACT', 'V3_ENGAGE', 'ROUTED_BY_LCV');
UPDATE public.call_funnel_projection SET highest_stage = 'teklif'    WHERE highest_stage IN ('V3_QUALIFIED', 'V4_INTENT');
UPDATE public.call_funnel_projection SET highest_stage = 'satis'     WHERE highest_stage IN ('V5_SEAL', 'V5_SEALED', 'sealed');
UPDATE public.call_funnel_projection SET highest_stage = 'junk'      WHERE highest_stage = 'pageview';

-- Known legacy mappings for current_stage (current_stage additionally
-- permits 'WAITING_FOR_ATTRIBUTION' — left untouched).
UPDATE public.call_funnel_projection SET current_stage = 'junk'      WHERE current_stage = 'V2_PULSE';
UPDATE public.call_funnel_projection SET current_stage = 'gorusuldu' WHERE current_stage IN ('V2_CONTACT', 'V3_ENGAGE', 'ROUTED_BY_LCV');
UPDATE public.call_funnel_projection SET current_stage = 'teklif'    WHERE current_stage IN ('V3_QUALIFIED', 'V4_INTENT');
UPDATE public.call_funnel_projection SET current_stage = 'satis'     WHERE current_stage IN ('V5_SEAL', 'V5_SEALED', 'sealed');
UPDATE public.call_funnel_projection SET current_stage = 'junk'      WHERE current_stage = 'pageview';

-- Catch-all with runtime logging so we know exactly what was collapsed.
DO $$
DECLARE
  v_collapsed_count int;
  v_samples text[];
BEGIN
  -- highest_stage: nullable, only non-canonical non-null values get collapsed.
  SELECT COUNT(*), array_agg(DISTINCT highest_stage ORDER BY highest_stage)
  INTO v_collapsed_count, v_samples
  FROM public.call_funnel_projection
  WHERE highest_stage IS NOT NULL
    AND highest_stage NOT IN (
      'junk', 'gorusuldu', 'contacted', 'teklif', 'offered', 'satis', 'won'
    );

  IF v_collapsed_count > 0 THEN
    RAISE NOTICE 'Backfill collapsing % non-canonical call_funnel_projection.highest_stage rows to junk. Values: %',
      v_collapsed_count, v_samples;

    UPDATE public.call_funnel_projection
    SET highest_stage = 'junk'
    WHERE highest_stage IS NOT NULL
      AND highest_stage NOT IN (
        'junk', 'gorusuldu', 'contacted', 'teklif', 'offered', 'satis', 'won'
      );
  END IF;

  -- current_stage: NOT NULL, must land in one of the allowed values.
  -- WAITING_FOR_ATTRIBUTION is preserved (it's in the Phase 3 CHECK allowed set).
  SELECT COUNT(*), array_agg(DISTINCT current_stage ORDER BY current_stage)
  INTO v_collapsed_count, v_samples
  FROM public.call_funnel_projection
  WHERE current_stage NOT IN (
    'junk', 'gorusuldu', 'contacted', 'teklif', 'offered', 'satis', 'won',
    'WAITING_FOR_ATTRIBUTION'
  );

  IF v_collapsed_count > 0 THEN
    RAISE NOTICE 'Backfill collapsing % non-canonical call_funnel_projection.current_stage rows to junk. Values: %',
      v_collapsed_count, v_samples;

    UPDATE public.call_funnel_projection
    SET current_stage = 'junk'
    WHERE current_stage NOT IN (
      'junk', 'gorusuldu', 'contacted', 'teklif', 'offered', 'satis', 'won',
      'WAITING_FOR_ATTRIBUTION'
    );
  END IF;
END $$;

COMMIT;
