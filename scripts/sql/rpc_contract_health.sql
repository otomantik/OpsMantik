-- RPC contract health pack (read-only)
-- Purpose: detect missing/signature-drifted/insecure grants for critical OCI RPCs.
--
-- Usage (Supabase SQL editor):
--   1) Run full script.
--   2) Expect "missing_or_drifted_count = 0" and no insecure grant rows.

WITH required AS (
  SELECT * FROM (
    VALUES
      ('get_call_session_for_oci', 'uuid, uuid', true),
      ('append_worker_transition_batch_v2', 'uuid[], text, timestamp with time zone, jsonb', true),
      ('apply_marketing_signal_dispatch_batch_v1', 'uuid, uuid[], text, text, timestamp with time zone', true),
      ('rescue_marketing_signals_stale_processing_v1', 'timestamp with time zone', true),
      ('rebuild_call_projection', 'uuid, uuid', true)
  ) AS t(proname, args, require_service_role)
),
actual AS (
  SELECT
    p.proname,
    oidvectortypes(p.proargtypes) AS args,
    p.prosecdef AS security_definer,
    p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
contract_diff AS (
  SELECT
    r.proname,
    r.args AS expected_args,
    a.args AS actual_args,
    CASE
      WHEN a.proname IS NULL THEN 'missing'
      WHEN a.args IS DISTINCT FROM r.args THEN 'signature_drift'
      ELSE 'ok'
    END AS contract_status
  FROM required r
  LEFT JOIN actual a
    ON a.proname = r.proname
)
SELECT
  proname,
  expected_args,
  actual_args,
  contract_status
FROM contract_diff
ORDER BY proname;

SELECT
  COUNT(*)::int AS missing_or_drifted_count
FROM (
  SELECT 1
  FROM (
    WITH required AS (
      SELECT * FROM (
        VALUES
          ('get_call_session_for_oci', 'uuid, uuid'),
          ('append_worker_transition_batch_v2', 'uuid[], text, timestamp with time zone, jsonb'),
          ('apply_marketing_signal_dispatch_batch_v1', 'uuid, uuid[], text, text, timestamp with time zone'),
          ('rescue_marketing_signals_stale_processing_v1', 'timestamp with time zone'),
          ('rebuild_call_projection', 'uuid, uuid')
      ) AS t(proname, args)
    )
    SELECT r.proname
    FROM required r
    LEFT JOIN (
      SELECT p.proname, oidvectortypes(p.proargtypes) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    ) a
      ON a.proname = r.proname
    WHERE a.proname IS NULL OR a.args IS DISTINCT FROM r.args
  ) z
) d;

-- Security-definer and grant posture (critical: get_call_session_for_oci must NOT be broadly callable)
SELECT
  p.proname,
  oidvectortypes(p.proargtypes) AS args,
  p.prosecdef AS security_definer,
  rp.grantee,
  rp.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN information_schema.routine_privileges rp
  ON rp.routine_schema = 'public'
 AND rp.routine_name = p.proname
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_call_session_for_oci',
    'append_worker_transition_batch_v2',
    'apply_marketing_signal_dispatch_batch_v1',
    'rescue_marketing_signals_stale_processing_v1',
    'rebuild_call_projection'
  )
ORDER BY p.proname, rp.grantee;

-- Unsafe grant detector (should return zero rows)
SELECT
  rp.routine_name,
  rp.grantee,
  rp.privilege_type
FROM information_schema.routine_privileges rp
WHERE rp.routine_schema = 'public'
  AND rp.routine_name = 'get_call_session_for_oci'
  AND rp.grantee IN ('anon', 'authenticated', 'PUBLIC');

-- Projection schema drift detector (should return projection_exists=true)
SELECT
  CASE WHEN to_regclass('public.call_funnel_projection') IS NOT NULL THEN true ELSE false END AS projection_exists,
  CASE WHEN to_regclass('public.call_funnel_ledger') IS NOT NULL THEN true ELSE false END AS ledger_exists;
