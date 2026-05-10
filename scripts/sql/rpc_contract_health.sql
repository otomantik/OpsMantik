-- @pack_id: rpc_contract_health
-- @contract_version: v1
-- @db_required: true
-- @red_green_criteria: RED when missing_or_drifted_count > 0 or unsafe grants exist.
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
      ('append_script_transition_batch', 'uuid[], text, timestamp with time zone, jsonb', true),
      ('append_script_claim_transition_batch', 'uuid[], timestamp with time zone', true),
      ('recover_stuck_offline_conversion_jobs', 'integer', true),
      ('recover_safe_processing_queue_rows_v1', 'uuid[], integer, text, text', true),
      ('acquire_cron_lease_v1', 'text, text, integer', true),
      ('steal_expired_cron_lease_v1', 'text, text, integer, integer', true),
      ('heartbeat_cron_lease_v1', 'text, text, integer', true),
      ('release_cron_lease_v1', 'text, text', true),
      ('try_acquire_cron_lock_v1', 'text', true),
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
          ('append_script_transition_batch', 'uuid[], text, timestamp with time zone, jsonb'),
          ('append_script_claim_transition_batch', 'uuid[], timestamp with time zone'),
          ('recover_stuck_offline_conversion_jobs', 'integer'),
          ('recover_safe_processing_queue_rows_v1', 'uuid[], integer, text, text'),
          ('acquire_cron_lease_v1', 'text, text, integer'),
          ('steal_expired_cron_lease_v1', 'text, text, integer, integer'),
          ('heartbeat_cron_lease_v1', 'text, text, integer'),
          ('release_cron_lease_v1', 'text, text'),
          ('try_acquire_cron_lock_v1', 'text'),
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
  p.proconfig AS function_config,
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
    'append_script_transition_batch',
    'append_script_claim_transition_batch',
    'recover_stuck_offline_conversion_jobs',
    'recover_safe_processing_queue_rows_v1',
    'acquire_cron_lease_v1',
    'steal_expired_cron_lease_v1',
    'heartbeat_cron_lease_v1',
    'release_cron_lease_v1',
    'try_acquire_cron_lock_v1',
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
  AND rp.routine_name IN (
    'get_call_session_for_oci',
    'recover_stuck_offline_conversion_jobs',
    'recover_safe_processing_queue_rows_v1',
    'acquire_cron_lease_v1',
    'steal_expired_cron_lease_v1',
    'heartbeat_cron_lease_v1',
    'release_cron_lease_v1',
    'try_acquire_cron_lock_v1'
  )
  AND rp.grantee IN ('anon', 'authenticated', 'PUBLIC');

-- Projection schema drift detector (should return projection_exists=true)
SELECT
  CASE WHEN to_regclass('public.call_funnel_projection') IS NOT NULL THEN true ELSE false END AS projection_exists,
  CASE WHEN to_regclass('public.call_funnel_ledger') IS NOT NULL THEN true ELSE false END AS ledger_exists;

-- Row-scoped recovery dependency contract (should return dependency_status=ok)
SELECT
  CASE
    WHEN to_regprocedure('public.recover_safe_processing_queue_rows_v1(uuid[],integer,text,text)') IS NULL THEN 'RECOVERY_RPC_MISSING'
    WHEN to_regprocedure('public.append_worker_transition_batch_v2(uuid[],text,timestamptz,jsonb)') IS NULL THEN 'RECOVERY_DEPENDENCY_MISSING'
    WHEN position('public.append_worker_transition_batch_v2' IN pg_get_functiondef(to_regprocedure('public.recover_safe_processing_queue_rows_v1(uuid[],integer,text,text)'))) = 0 THEN 'RECOVERY_DEPENDENCY_DRIFT'
    ELSE 'ok'
  END AS dependency_status;
