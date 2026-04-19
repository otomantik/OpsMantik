-- 20260419137000_backfill_call_funnel_ledger_event_type.sql
--
-- Phase 3 prerequisite (second pass): backfill legacy
-- `call_funnel_ledger.event_type` values that 20260419135000 did not cover.
-- 20260419140000 adds the CHECK:
--
--   event_type IN (
--     'junk',
--     'gorusuldu', 'contacted',
--     'teklif', 'offered',
--     'satis', 'won',
--     'V1_PAGEVIEW', 'V2_CONTACT', 'V2_PULSE', 'V2_SYNTHETIC',
--     'REPAIR_ATTEMPTED', 'REPAIR_COMPLETED', 'REPAIR_FAILED',
--     'SYSTEM_JUNK', 'system_repair'
--   )
--
-- The allowed set preserves V1/V2 markers (historical pageview/contact event
-- types) but *not* V3/V4/V5 — those were renamed to the Turkish stage
-- literals (gorusuldu/teklif/satis). Rows written before that cutover are
-- still lying around as `V3_ENGAGE`, `V4_INTENT`, `V5_SEAL`, etc.
--
-- Mapping mirrors the marketing_signals backfill (20260419135000) so the
-- ledger stays consistent with the signal table and the downstream
-- projection reducer.
--
-- Idempotent: re-running is a no-op after the first successful apply.

BEGIN;

-- Drop the legacy narrower CHECK *before* backfilling. The pre-Phase 3 CHECK
-- `call_funnel_ledger_event_type_check` only permits V-stage literals and
-- rejects the Turkish canonical names we need to rewrite rows to. Migration
-- 20260419140000 re-adds the widened `enforce_canonical_event_type` CHECK
-- (canonical + legacy markers) right after this backfill runs, so we are
-- only unprotected for the duration of this transaction.
ALTER TABLE public.call_funnel_ledger
  DROP CONSTRAINT IF EXISTS call_funnel_ledger_event_type_check;

UPDATE public.call_funnel_ledger SET event_type = 'gorusuldu' WHERE event_type = 'V3_ENGAGE';
UPDATE public.call_funnel_ledger SET event_type = 'teklif'    WHERE event_type = 'V3_QUALIFIED';
UPDATE public.call_funnel_ledger SET event_type = 'teklif'    WHERE event_type = 'V4_INTENT';
UPDATE public.call_funnel_ledger SET event_type = 'satis'     WHERE event_type = 'V5_SEAL';
UPDATE public.call_funnel_ledger SET event_type = 'satis'     WHERE event_type = 'sealed';
UPDATE public.call_funnel_ledger SET event_type = 'V1_PAGEVIEW' WHERE event_type = 'pageview';
UPDATE public.call_funnel_ledger SET event_type = 'gorusuldu' WHERE event_type = 'ROUTED_BY_LCV';

-- Catch-all: anything still outside the allowed set collapses to 'junk'.
-- Log what we touched so the audit trail survives in the deploy log.
DO $$
DECLARE
  v_collapsed_count int;
  v_samples text[];
BEGIN
  SELECT COUNT(*), array_agg(DISTINCT event_type ORDER BY event_type)
  INTO v_collapsed_count, v_samples
  FROM public.call_funnel_ledger
  WHERE event_type NOT IN (
    'junk',
    'gorusuldu', 'contacted',
    'teklif', 'offered',
    'satis', 'won',
    'V1_PAGEVIEW', 'V2_CONTACT', 'V2_PULSE', 'V2_SYNTHETIC',
    'REPAIR_ATTEMPTED', 'REPAIR_COMPLETED', 'REPAIR_FAILED',
    'SYSTEM_JUNK', 'system_repair'
  );

  IF v_collapsed_count > 0 THEN
    RAISE NOTICE 'Backfill collapsing % non-canonical call_funnel_ledger.event_type rows to junk. Values: %',
      v_collapsed_count, v_samples;

    UPDATE public.call_funnel_ledger
    SET event_type = 'junk'
    WHERE event_type NOT IN (
      'junk',
      'gorusuldu', 'contacted',
      'teklif', 'offered',
      'satis', 'won',
      'V1_PAGEVIEW', 'V2_CONTACT', 'V2_PULSE', 'V2_SYNTHETIC',
      'REPAIR_ATTEMPTED', 'REPAIR_COMPLETED', 'REPAIR_FAILED',
      'SYSTEM_JUNK', 'system_repair'
    );
  END IF;
END $$;

COMMIT;
