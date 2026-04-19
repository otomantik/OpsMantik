-- =============================================================================
-- OpsMantik Phase 4 — ingest_fallback_buffer DROP
-- =============================================================================
-- Removes the third ingest-idempotency layer. We keep two stronger mechanisms:
--   (1) client-side idempotency key + client retry
--   (2) QStash built-in retries with dedup
-- The fallback buffer was a silent-at-rest PII surface, three RPCs, a cron,
-- and an extra table every compliance review had to reason about. /api/sync
-- already returns 503 when both QStash and the direct-worker fallback fail,
-- so the client-side retry loop is the correct recovery path.
--
-- Dropped surface:
--   • public.ingest_fallback_buffer                                 (table)
--   • public.recover_stuck_ingest_fallback(int)                     (RPC)
--   • public.get_and_claim_fallback_batch(int)                      (RPC)
--   • public.update_fallback_on_publish_failure(jsonb)              (RPC)
--   • public.ingest_fallback_status                                 (enum, if unused)
--
-- Rewritten consumers (to kill dangling references):
--   • public.erase_pii_for_identifier(uuid, text, text)
--       → step 9 removed; return shape preserved (ingest_fallback_affected
--         always 0) so /api/gdpr/erase stays wire-compatible.
--   • public.reset_business_data_before_cutoff_v1(timestamptz, boolean)
--       → ingest_fallback_buffer line dropped from INSERT/UPDATE/DELETE.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Drop fallback-specific RPCs (they reference the table body).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.recover_stuck_ingest_fallback(int);
DROP FUNCTION IF EXISTS public.get_and_claim_fallback_batch(int);
DROP FUNCTION IF EXISTS public.update_fallback_on_publish_failure(jsonb);

-- ---------------------------------------------------------------------------
-- 2) Drop the table itself (CASCADE catches any lingering FK / view).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.ingest_fallback_buffer CASCADE;

-- ---------------------------------------------------------------------------
-- 3) Drop the status enum when unreferenced.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingest_fallback_status') THEN
    BEGIN
      DROP TYPE public.ingest_fallback_status;
    EXCEPTION WHEN dependent_objects_still_exist THEN
      -- Another column still uses it; leave in place.
      NULL;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Rewrite erase_pii_for_identifier. Keeps 8-column return shape for
--    /api/gdpr/erase; ingest_fallback_affected is always 0 (table dropped).
--
-- Defensive DROP: the pre-Phase 4 function may have returned a different
-- column shape in some environments; CREATE OR REPLACE refuses to change
-- return types. DROP-then-CREATE makes this migration safe to replay on
-- any historical state.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.erase_pii_for_identifier(uuid, text, text);

CREATE OR REPLACE FUNCTION public.erase_pii_for_identifier(
  p_site_id uuid,
  p_identifier_type text,
  p_identifier_value text
)
RETURNS TABLE (
  sessions_affected bigint,
  events_affected bigint,
  calls_affected bigint,
  conversations_affected bigint,
  sales_affected bigint,
  ociq_affected bigint,
  sync_dlq_affected bigint,
  ingest_fallback_affected bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_ids uuid[] := '{}';
  v_call_ids uuid[] := '{}';
  v_sale_ociq bigint := 0;
  v_sessions bigint := 0;
  v_events bigint := 0;
  v_calls bigint := 0;
  v_conversations bigint := 0;
  v_sales bigint := 0;
  v_ociq bigint := 0;
  v_dlq bigint := 0;
  v_redacted jsonb;
  v_conversation_ids uuid[];
  v_sale_ids uuid[];
BEGIN
  IF p_identifier_type IS NULL OR NULLIF(TRIM(p_identifier_value), '') IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  v_redacted := jsonb_build_object(
    'redacted', true,
    'redacted_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reason', 'gdpr_erase'
  );

  IF p_identifier_type NOT IN ('session_id', 'fingerprint', 'email') THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF p_identifier_type = 'session_id' THEN
    SELECT array_agg(id) INTO v_session_ids
      FROM public.sessions WHERE site_id = p_site_id AND id::text = p_identifier_value;
  ELSIF p_identifier_type = 'fingerprint' THEN
    SELECT array_agg(id) INTO v_session_ids
      FROM public.sessions WHERE site_id = p_site_id AND fingerprint = p_identifier_value;
  ELSIF p_identifier_type = 'email' THEN
    SELECT array_agg(s.id) INTO v_session_ids
      FROM public.sessions s
      LEFT JOIN public.users u ON u.id = s.user_id
      WHERE s.site_id = p_site_id AND (LOWER(u.email) = LOWER(p_identifier_value));
  END IF;
  v_session_ids := COALESCE(v_session_ids, '{}');

  WITH upds AS (
    UPDATE public.sessions
    SET fingerprint = NULL, ip = NULL, user_agent = NULL, user_id = NULL
    WHERE id = ANY(v_session_ids)
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_sessions FROM upds;

  WITH upds AS (
    UPDATE public.events
    SET ip = NULL, user_agent = NULL
    WHERE session_id = ANY(v_session_ids)
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_events FROM upds;

  WITH upds AS (
    UPDATE public.calls
    SET caller_phone = NULL,
        caller_phone_hash = NULL,
        caller_name = NULL,
        call_metadata = v_redacted
    WHERE session_id = ANY(v_session_ids)
    RETURNING id
  )
  SELECT count(*)::bigint, COALESCE(array_agg(id), '{}') INTO v_calls, v_call_ids FROM upds;

  WITH upds AS (
    UPDATE public.conversations
    SET
      user_input = v_redacted::text,
      oci_payload = v_redacted
    WHERE call_id = ANY(v_call_ids)
    RETURNING id
  )
  SELECT count(*)::bigint, COALESCE(array_agg(id), '{}') INTO v_conversations, v_conversation_ids FROM upds;

  WITH upds AS (
    UPDATE public.sales
    SET customer_name = v_redacted::text,
        customer_phone = NULL
    WHERE conversation_id = ANY(v_conversation_ids)
    RETURNING id
  )
  SELECT count(*)::bigint, COALESCE(array_agg(id), '{}') INTO v_sales, v_sale_ids FROM upds;

  IF array_length(v_call_ids, 1) IS NOT NULL THEN
    WITH upds AS (
      UPDATE public.offline_conversion_queue
      SET payload = COALESCE(payload, '{}'::jsonb) || v_redacted
      WHERE call_id = ANY(v_call_ids)
      RETURNING 1
    )
    SELECT count(*)::bigint INTO v_ociq FROM upds;
  END IF;

  IF array_length(v_sale_ids, 1) IS NOT NULL THEN
    WITH upds AS (
      UPDATE public.offline_conversion_queue
      SET payload = COALESCE(payload, '{}'::jsonb) || v_redacted
      WHERE sale_id = ANY(v_sale_ids)
      RETURNING 1
    )
    SELECT count(*)::bigint INTO v_sale_ociq FROM upds;
  END IF;
  v_ociq := v_ociq + v_sale_ociq;

  WITH upds AS (
    UPDATE public.sync_dlq
    SET payload = v_redacted
    WHERE (site_id = p_site_id OR site_id IS NULL)
      AND (
        (payload->>'sid' = p_identifier_value)
        OR (payload->'meta'->>'fp' = p_identifier_value)
        OR (payload->'meta'->>'fingerprint' = p_identifier_value)
        OR (payload->'meta'->>'email')::text ILIKE p_identifier_value
        OR (payload->>'email')::text ILIKE p_identifier_value
      )
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_dlq FROM upds;

  -- ingest_fallback_buffer removed in 20260419180000; return 0 for backward compat.
  RETURN QUERY SELECT v_sessions, v_events, v_calls, v_conversations, v_sales, v_ociq, v_dlq, 0::bigint;
END;
$$;

COMMENT ON FUNCTION public.erase_pii_for_identifier(uuid, text, text) IS
  'KVKK/GDPR: PII anonymization by identifier. session_id|fingerprint|email. ingest_fallback_affected is always 0 (table dropped 20260419180000).';

GRANT EXECUTE ON FUNCTION public.erase_pii_for_identifier(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Rewrite reset_business_data_before_cutoff_v1 without fallback refs.
--    Verbatim copy of the 20260419170000 body minus the three
--    ingest_fallback_buffer lines (one INSERT summary row, one count UPDATE,
--    one DELETE). All other behavior identical.
--
-- Defensive DROP to match 20260419170000 — some Postgres versions fail
-- CREATE OR REPLACE on signature or return-type drift, DROP guarantees a
-- clean slate.
-- ---------------------------------------------------------------------------
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
  'TRT cutoff reset kernel. Phase 4: ingest_fallback_buffer references dropped (table retired 20260419180000). service_role only.';

GRANT EXECUTE ON FUNCTION public.reset_business_data_before_cutoff_v1(timestamptz, boolean)
  TO service_role;

COMMIT;
