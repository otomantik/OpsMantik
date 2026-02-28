-- =============================================================================
-- Database Deep Clean (Pre-Iron Seal)
-- =============================================================================
-- GOAL: Remove ALL historical test data, intent logs, and session records
--       created BEFORE today (2026-02-28). Preserve today's work.
--
-- CRITICAL: Run in Supabase SQL Editor. Requires service_role or sufficient
--           privileges for DELETE. Review counts before uncommenting final block.
--
-- Cutoff: 2026-02-28 00:00:00 UTC — delete records where timestamp < cutoff
-- =============================================================================

-- Cutoff: 2026-02-28 00:00:00+00 (start of today UTC)

-- =============================================================================
-- STEP 0: PREVIEW — Count rows to be deleted (run first, review output)
-- =============================================================================

SELECT 'sync_dlq_replay_audit' AS tbl, COUNT(*) AS to_delete
FROM sync_dlq_replay_audit r
JOIN sync_dlq d ON d.id = r.dlq_id
WHERE d.received_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'sync_dlq', COUNT(*) FROM sync_dlq WHERE received_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'events', COUNT(*) FROM events WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'call_actions', COUNT(*) FROM call_actions WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'call_scores', COUNT(*) FROM call_scores WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'offline_conversion_queue', COUNT(*) FROM offline_conversion_queue WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'sales', COUNT(*) FROM sales WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'conversation_links', COUNT(*) FROM conversation_links WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'conversations', COUNT(*) FROM conversations WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'calls', COUNT(*) FROM calls WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'sessions', COUNT(*) FROM sessions WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'ingest_idempotency', COUNT(*) FROM ingest_idempotency WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'ingest_fallback_buffer', COUNT(*) FROM ingest_fallback_buffer WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'ingest_fraud_quarantine', COUNT(*) FROM ingest_fraud_quarantine WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'ingest_publish_failures', COUNT(*) FROM ingest_publish_failures WHERE created_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'processed_signals', COUNT(*) FROM processed_signals WHERE received_at < '2026-02-28 00:00:00+00'
UNION ALL
SELECT 'conversions', COUNT(*) FROM conversions WHERE created_at < '2026-02-28 00:00:00+00';

-- =============================================================================
-- STEP 1: EXECUTE CLEANUP (children first due to FK constraints)
--         Run STEP 0 first to preview counts.
-- =============================================================================

BEGIN;

-- 1) sync_dlq_replay_audit (child of sync_dlq)
DELETE FROM sync_dlq_replay_audit
WHERE dlq_id IN (SELECT id FROM sync_dlq WHERE received_at < '2026-02-28 00:00:00+00');

-- 2) sync_dlq
DELETE FROM sync_dlq WHERE received_at < '2026-02-28 00:00:00+00';

-- 3) events (child of sessions)
DELETE FROM events WHERE created_at < '2026-02-28 00:00:00+00';

-- 4) call_actions (child of calls)
DELETE FROM call_actions WHERE created_at < '2026-02-28 00:00:00+00';

-- 5) call_scores (child of calls)
DELETE FROM call_scores WHERE created_at < '2026-02-28 00:00:00+00';

-- 6) offline_conversion_queue (references calls or sales)
DELETE FROM offline_conversion_queue WHERE created_at < '2026-02-28 00:00:00+00';

-- 7) sales (child of conversations)
DELETE FROM sales WHERE created_at < '2026-02-28 00:00:00+00';

-- 8) conversation_links (child of conversations)
DELETE FROM conversation_links WHERE created_at < '2026-02-28 00:00:00+00';

-- 9) conversations
DELETE FROM conversations WHERE created_at < '2026-02-28 00:00:00+00';

-- 10) calls
DELETE FROM calls WHERE created_at < '2026-02-28 00:00:00+00';

-- 11) sessions
DELETE FROM sessions WHERE created_at < '2026-02-28 00:00:00+00';

-- 12) ingest tables
DELETE FROM ingest_idempotency WHERE created_at < '2026-02-28 00:00:00+00';
DELETE FROM ingest_fallback_buffer WHERE created_at < '2026-02-28 00:00:00+00';
DELETE FROM ingest_fraud_quarantine WHERE created_at < '2026-02-28 00:00:00+00';
DELETE FROM ingest_publish_failures WHERE created_at < '2026-02-28 00:00:00+00';

-- 13) processed_signals
DELETE FROM processed_signals WHERE received_at < '2026-02-28 00:00:00+00';

-- 14) conversions (no FK)
DELETE FROM conversions WHERE created_at < '2026-02-28 00:00:00+00';

COMMIT;


-- =============================================================================
-- TABLES NOT TOUCHED (preserved)
-- =============================================================================
-- sites, profiles, site_members — tenant/user setup
-- provider_credentials, provider_health_state — credentials & circuit breaker
-- ad_spend_daily, provider_upload_metrics, provider_upload_attempts — operational
-- audit_log — optional; add DELETE if desired
-- billing_reconciliation_jobs, site_usage_monthly, invoice_snapshot — billing SoT
