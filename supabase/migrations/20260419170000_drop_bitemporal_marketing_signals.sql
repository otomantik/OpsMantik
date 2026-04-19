-- =============================================================================
-- OpsMantik Phase 4 — Bitemporal Marketing Signals DROP
-- =============================================================================
-- Removes the Phase 11 time-travel/audit machinery. Rationale: Google Ads audit
-- support turned out to be YAGNI — nothing in the product reads the history
-- table or the get_marketing_signals_as_of RPC, and every UPDATE paid the cost
-- of a history INSERT + range open/close even though no consumer ever queried
-- past states. Replacing it with the plain updated_at column (already exists
-- post-20261113000000) keeps "when was this last touched?" observability
-- cheap and removes the trigger / range-index / history-table surface.
--
-- Removed surface:
--   • public.marketing_signals.sys_period                     (tstzrange)
--   • public.marketing_signals.valid_period                   (tstzrange)
--   • public.marketing_signals_history                        (LIKE-copy audit table)
--   • public.marketing_signals_bitemporal_audit()             (BEFORE UPDATE trigger fn)
--   • trg_marketing_signals_bitemporal                        (trigger)
--   • public.get_marketing_signals_as_of(uuid, timestamptz)   (time-travel RPC)
--   • idx_marketing_signals_sys_period / _valid_period / _site_sys_period
--
-- Rewritten surface (to kill all references to the dropped table/columns):
--   • public.recover_stuck_marketing_signals(int)  →  uses updated_at
--   • public.reset_business_data_before_cutoff_v1(timestamptz, boolean)
--       → drops marketing_signals_history count + delete branches
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Rewrite consumers to stop referencing the soon-to-be-dropped surface.
-- ---------------------------------------------------------------------------

-- recover_stuck_marketing_signals: swap the dropped sys_period range clock
-- for the plain updated_at column.
--
-- Postgres does not allow CREATE OR REPLACE FUNCTION to change the return
-- type. The pre-Phase 4 function returned `SETOF uuid` (or similar); we are
-- widening to TABLE(recovered_id uuid) so callers can rely on a stable
-- column name. DROP first, then CREATE.
DROP FUNCTION IF EXISTS public.recover_stuck_marketing_signals(int);

CREATE OR REPLACE FUNCTION public.recover_stuck_marketing_signals(
  p_min_age_minutes int DEFAULT 240
)
RETURNS TABLE(recovered_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cutoff AS (
    SELECT now() - make_interval(mins => GREATEST(p_min_age_minutes, 1)) AS v_cutoff
  )
  UPDATE public.marketing_signals ms
  SET dispatch_status = 'PENDING'
  FROM cutoff
  WHERE ms.dispatch_status = 'PROCESSING'
    AND ms.updated_at < cutoff.v_cutoff
  RETURNING ms.id;
$$;

COMMENT ON FUNCTION public.recover_stuck_marketing_signals(int) IS
  'Stuck-Signal-Recoverer: PROCESSING signals older than p_min_age_minutes -> PENDING (re-exportable). Uses marketing_signals.updated_at (bitemporal ledger retired Phase 4). service_role only.';

GRANT EXECUTE ON FUNCTION public.recover_stuck_marketing_signals(int)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Drop the bitemporal audit machinery.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_marketing_signals_bitemporal ON public.marketing_signals;
DROP FUNCTION IF EXISTS public.marketing_signals_bitemporal_audit() CASCADE;
DROP FUNCTION IF EXISTS public.get_marketing_signals_as_of(uuid, timestamptz) CASCADE;

DROP TABLE IF EXISTS public.marketing_signals_history CASCADE;

DROP INDEX IF EXISTS public.idx_marketing_signals_sys_period;
DROP INDEX IF EXISTS public.idx_marketing_signals_valid_period;
DROP INDEX IF EXISTS public.idx_marketing_signals_site_sys_period;

ALTER TABLE public.marketing_signals
  DROP COLUMN IF EXISTS sys_period,
  DROP COLUMN IF EXISTS valid_period;

-- ---------------------------------------------------------------------------
-- 3) Rewrite reset_business_data_before_cutoff_v1 without history refs.
-- ---------------------------------------------------------------------------
-- This is verbatim to the 20261106213000_trt_cutoff_reset_kernel.sql body
-- with the two marketing_signals_history steps removed. Behavior: same cutoff
-- semantics, same ordering of dry-run/delete phases, minus the history table
-- that no longer exists.
--
-- Same DROP-then-CREATE pattern as recover_stuck_marketing_signals above:
-- earlier versions of this function may have returned a different row shape,
-- and Postgres refuses to CHANGE return type via OR REPLACE.
DROP FUNCTION IF EXISTS public.reset_business_data_before_cutoff_v1(timestamptz, boolean);

CREATE OR REPLACE FUNCTION public.reset_business_data_before_cutoff_v1(
  p_cutoff timestamptz,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(step text, affected bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'reset_business_data_before_cutoff_v1 may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'cutoff_required' USING ERRCODE = '22004';
  END IF;

  IF p_cutoff >= now() THEN
    RAISE EXCEPTION 'cutoff_must_be_in_the_past' USING ERRCODE = '22007';
  END IF;

  DROP TABLE IF EXISTS tmp_reset_summary;
  DROP TABLE IF EXISTS tmp_old_sessions;
  DROP TABLE IF EXISTS tmp_old_events;
  DROP TABLE IF EXISTS tmp_old_calls;
  DROP TABLE IF EXISTS tmp_old_conversations;
  DROP TABLE IF EXISTS tmp_old_sales;
  DROP TABLE IF EXISTS tmp_old_snapshots;
  DROP TABLE IF EXISTS tmp_old_sync_dlq;
  DROP TABLE IF EXISTS tmp_old_queue;
  DROP TABLE IF EXISTS tmp_old_signals;

  CREATE TEMP TABLE tmp_reset_summary (
    step text PRIMARY KEY,
    affected bigint NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  CREATE TEMP TABLE tmp_old_sessions ON COMMIT DROP AS
    SELECT s.id FROM public.sessions s WHERE s.created_at < p_cutoff;
  CREATE TEMP TABLE tmp_old_events ON COMMIT DROP AS
    SELECT e.id FROM public.events e WHERE e.created_at < p_cutoff;
  CREATE TEMP TABLE tmp_old_calls ON COMMIT DROP AS
    SELECT c.id FROM public.calls c WHERE c.created_at < p_cutoff;
  CREATE TEMP TABLE tmp_old_conversations ON COMMIT DROP AS
    SELECT c.id
    FROM public.conversations c
    WHERE c.created_at < p_cutoff
       OR c.primary_call_id IN (SELECT id FROM tmp_old_calls)
       OR c.primary_session_id IN (SELECT id FROM tmp_old_sessions);
  CREATE TEMP TABLE tmp_old_sales ON COMMIT DROP AS
    SELECT s.id
    FROM public.sales s
    WHERE COALESCE(s.occurred_at, s.created_at) < p_cutoff
       OR s.conversation_id IN (SELECT id FROM tmp_old_conversations);
  CREATE TEMP TABLE tmp_old_snapshots ON COMMIT DROP AS
    SELECT r.id
    FROM public.revenue_snapshots r
    WHERE r.created_at < p_cutoff
       OR r.call_id IN (SELECT id FROM tmp_old_calls)
       OR r.sale_id IN (SELECT id FROM tmp_old_sales);
  CREATE TEMP TABLE tmp_old_sync_dlq ON COMMIT DROP AS
    SELECT d.id FROM public.sync_dlq d WHERE d.received_at < p_cutoff;
  CREATE TEMP TABLE tmp_old_queue ON COMMIT DROP AS
    SELECT q.id
    FROM public.offline_conversion_queue q
    WHERE q.call_id IN (SELECT id FROM tmp_old_calls)
       OR q.sale_id IN (SELECT id FROM tmp_old_sales)
       OR COALESCE(q.occurred_at, q.conversion_time, q.created_at) < p_cutoff;
  CREATE TEMP TABLE tmp_old_signals ON COMMIT DROP AS
    SELECT m.id
    FROM public.marketing_signals m
    WHERE m.call_id IN (SELECT id FROM tmp_old_calls)
       OR COALESCE(m.occurred_at, m.recorded_at, m.created_at) < p_cutoff;

  INSERT INTO tmp_reset_summary(step, affected) VALUES
    ('provider_dispatches', 0),
    ('revenue_snapshots', 0),
    ('outbox_events', 0),
    ('marketing_signals', 0),
    ('offline_conversion_tombstones', 0),
    ('oci_queue_transitions', 0),
    ('offline_conversion_queue', 0),
    ('sales', 0),
    ('conversation_links', 0),
    ('conversations', 0),
    ('call_scores', 0),
    ('call_actions', 0),
    ('calls', 0),
    ('events', 0),
    ('sessions', 0),
    ('processed_signals', 0),
    ('ingest_idempotency', 0),
    ('ingest_fallback_buffer', 0),
    ('sync_dlq_replay_audit', 0),
    ('sync_dlq', 0),
    ('audit_log', 0),
    ('gdpr_consents', 0),
    ('shadow_decisions', 0),
    ('causal_dna_ledger', 0),
    ('causal_dna_ledger_failures', 0),
    ('system_integrity_merkle', 0),
    ('signal_entropy_by_fingerprint', 0),
    ('conversions', 0),
    ('ingest_publish_failures', 0);

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.provider_dispatches pd
    WHERE pd.snapshot_id IN (SELECT id FROM tmp_old_snapshots) OR pd.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'provider_dispatches';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.revenue_snapshots r
    WHERE r.id IN (SELECT id FROM tmp_old_snapshots)
  ) AS sub WHERE tmp_reset_summary.step = 'revenue_snapshots';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.outbox_events o
    WHERE o.call_id IN (SELECT id FROM tmp_old_calls) OR o.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'outbox_events';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.marketing_signals m
    WHERE m.id IN (SELECT id FROM tmp_old_signals)
  ) AS sub WHERE tmp_reset_summary.step = 'marketing_signals';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.offline_conversion_tombstones t WHERE t.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'offline_conversion_tombstones';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.oci_queue_transitions t
    WHERE t.queue_id IN (SELECT id FROM tmp_old_queue) OR t.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'oci_queue_transitions';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.offline_conversion_queue q WHERE q.id IN (SELECT id FROM tmp_old_queue)
  ) AS sub WHERE tmp_reset_summary.step = 'offline_conversion_queue';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.sales s WHERE s.id IN (SELECT id FROM tmp_old_sales)
  ) AS sub WHERE tmp_reset_summary.step = 'sales';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.conversation_links cl
    WHERE cl.conversation_id IN (SELECT id FROM tmp_old_conversations)
       OR (cl.entity_type = 'call' AND cl.entity_id IN (SELECT id FROM tmp_old_calls))
       OR (cl.entity_type = 'session' AND cl.entity_id IN (SELECT id FROM tmp_old_sessions))
       OR (cl.entity_type = 'event' AND cl.entity_id IN (SELECT id FROM tmp_old_events))
       OR cl.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'conversation_links';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.conversations c WHERE c.id IN (SELECT id FROM tmp_old_conversations)
  ) AS sub WHERE tmp_reset_summary.step = 'conversations';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.call_scores cs
    WHERE cs.call_id IN (SELECT id FROM tmp_old_calls) OR cs.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'call_scores';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.call_actions ca
    WHERE ca.call_id IN (SELECT id FROM tmp_old_calls) OR ca.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'call_actions';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.calls c WHERE c.id IN (SELECT id FROM tmp_old_calls)
  ) AS sub WHERE tmp_reset_summary.step = 'calls';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.events e WHERE e.id IN (SELECT id FROM tmp_old_events)
  ) AS sub WHERE tmp_reset_summary.step = 'events';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.sessions s WHERE s.id IN (SELECT id FROM tmp_old_sessions)
  ) AS sub WHERE tmp_reset_summary.step = 'sessions';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.processed_signals p WHERE p.received_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'processed_signals';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.ingest_idempotency i WHERE i.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'ingest_idempotency';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.ingest_fallback_buffer b WHERE b.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'ingest_fallback_buffer';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.sync_dlq_replay_audit a
    WHERE a.dlq_id IN (SELECT id FROM tmp_old_sync_dlq) OR a.replayed_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'sync_dlq_replay_audit';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.sync_dlq d WHERE d.id IN (SELECT id FROM tmp_old_sync_dlq)
  ) AS sub WHERE tmp_reset_summary.step = 'sync_dlq';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.audit_log a WHERE a.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'audit_log';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.gdpr_consents g WHERE g.consent_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'gdpr_consents';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.shadow_decisions s WHERE s.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'shadow_decisions';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.causal_dna_ledger c WHERE c.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'causal_dna_ledger';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.causal_dna_ledger_failures c WHERE c.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'causal_dna_ledger_failures';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.system_integrity_merkle s WHERE s.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'system_integrity_merkle';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.signal_entropy_by_fingerprint s WHERE s.updated_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'signal_entropy_by_fingerprint';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.conversions c WHERE c.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'conversions';

  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (
    SELECT count(*)::bigint AS cnt FROM public.ingest_publish_failures i WHERE i.created_at < p_cutoff
  ) AS sub WHERE tmp_reset_summary.step = 'ingest_publish_failures';

  IF p_dry_run THEN
    RETURN QUERY
    SELECT s.step, s.affected FROM tmp_reset_summary s WHERE s.affected > 0 ORDER BY s.step;
    RETURN;
  END IF;

  PERFORM set_config('statement_timeout', '0', true);
  PERFORM set_config('app.opsmantik_reset_mode', 'on', true);

  DELETE FROM public.provider_dispatches
  WHERE snapshot_id IN (SELECT id FROM tmp_old_snapshots) OR created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'provider_dispatches';

  DELETE FROM public.revenue_snapshots WHERE id IN (SELECT id FROM tmp_old_snapshots);
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'revenue_snapshots';

  DELETE FROM public.outbox_events
  WHERE call_id IN (SELECT id FROM tmp_old_calls) OR created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'outbox_events';

  DELETE FROM public.marketing_signals WHERE id IN (SELECT id FROM tmp_old_signals);
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'marketing_signals';

  DELETE FROM public.offline_conversion_tombstones WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'offline_conversion_tombstones';

  DELETE FROM public.oci_queue_transitions
  WHERE queue_id IN (SELECT id FROM tmp_old_queue) OR created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'oci_queue_transitions';

  DELETE FROM public.offline_conversion_queue WHERE id IN (SELECT id FROM tmp_old_queue);
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'offline_conversion_queue';

  DELETE FROM public.sales WHERE id IN (SELECT id FROM tmp_old_sales);
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'sales';

  DELETE FROM public.conversation_links
  WHERE conversation_id IN (SELECT id FROM tmp_old_conversations)
     OR (entity_type = 'call' AND entity_id IN (SELECT id FROM tmp_old_calls))
     OR (entity_type = 'session' AND entity_id IN (SELECT id FROM tmp_old_sessions))
     OR (entity_type = 'event' AND entity_id IN (SELECT id FROM tmp_old_events))
     OR created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'conversation_links';

  DELETE FROM public.conversations WHERE id IN (SELECT id FROM tmp_old_conversations);
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'conversations';

  DELETE FROM public.call_scores
  WHERE call_id IN (SELECT id FROM tmp_old_calls) OR created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'call_scores';

  DELETE FROM public.call_actions
  WHERE call_id IN (SELECT id FROM tmp_old_calls) OR created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'call_actions';

  DELETE FROM public.calls WHERE id IN (SELECT id FROM tmp_old_calls);
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'calls';

  DELETE FROM public.events WHERE id IN (SELECT id FROM tmp_old_events);
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'events';

  DELETE FROM public.sessions WHERE id IN (SELECT id FROM tmp_old_sessions);
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'sessions';

  DELETE FROM public.processed_signals WHERE received_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'processed_signals';

  DELETE FROM public.ingest_idempotency WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'ingest_idempotency';

  DELETE FROM public.ingest_fallback_buffer WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'ingest_fallback_buffer';

  DELETE FROM public.sync_dlq_replay_audit
  WHERE dlq_id IN (SELECT id FROM tmp_old_sync_dlq) OR replayed_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'sync_dlq_replay_audit';

  DELETE FROM public.sync_dlq WHERE id IN (SELECT id FROM tmp_old_sync_dlq);
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'sync_dlq';

  DELETE FROM public.audit_log WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'audit_log';

  DELETE FROM public.gdpr_consents WHERE consent_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'gdpr_consents';

  DELETE FROM public.shadow_decisions WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'shadow_decisions';

  DELETE FROM public.causal_dna_ledger WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'causal_dna_ledger';

  DELETE FROM public.causal_dna_ledger_failures WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'causal_dna_ledger_failures';

  DELETE FROM public.system_integrity_merkle WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'system_integrity_merkle';

  DELETE FROM public.signal_entropy_by_fingerprint WHERE updated_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'signal_entropy_by_fingerprint';

  DELETE FROM public.conversions WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'conversions';

  DELETE FROM public.ingest_publish_failures WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'ingest_publish_failures';

  PERFORM set_config('app.opsmantik_reset_mode', 'off', true);

  RETURN QUERY
  SELECT s.step, s.affected FROM tmp_reset_summary s WHERE s.affected > 0 ORDER BY s.step;
END;
$$;

COMMENT ON FUNCTION public.reset_business_data_before_cutoff_v1(timestamptz, boolean) IS
  'TRT cutoff reset kernel. Deletes rows older than p_cutoff across the business graph. Phase 4: marketing_signals_history references dropped (bitemporal ledger retired). service_role only.';

GRANT EXECUTE ON FUNCTION public.reset_business_data_before_cutoff_v1(timestamptz, boolean)
  TO service_role;

COMMIT;
