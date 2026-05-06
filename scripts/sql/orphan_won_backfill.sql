-- Incident playbook: orphan won/sealed recovery (dry-run first).
-- This playbook is idempotent and read-only by default.
--
-- IMPORTANT:
-- - Do NOT delete rows from offline_conversion_queue during incident mitigation.
-- - Keep script-mode active while repairing won leaks.
-- - Prefer app-side enqueue SSOT (enqueueSealConversion) for actual repair writes.

-- [STEP 1] Dry-run candidates + deterministic reason
WITH base AS (
  SELECT
    c.id AS call_id,
    c.site_id,
    c.status,
    c.oci_status,
    c.confirmed_at,
    c.caller_phone_e164,
    c.matched_session_id
  FROM public.calls c
  WHERE (c.status = 'won' OR c.oci_status = 'sealed')
),
queue_presence AS (
  SELECT DISTINCT q.call_id, q.site_id
  FROM public.offline_conversion_queue q
),
session_clicks AS (
  SELECT
    s.id AS session_id,
    s.site_id,
    s.gclid,
    s.wbraid,
    s.gbraid
  FROM public.sessions s
),
candidates AS (
  SELECT
    b.call_id,
    b.site_id,
    b.status,
    b.oci_status,
    b.confirmed_at,
    sc.gclid,
    sc.wbraid,
    sc.gbraid,
    CASE
      WHEN b.call_id IS NULL THEN 'missing_call_id'
      WHEN b.site_id IS NULL THEN 'missing_site_id'
      WHEN qp.call_id IS NOT NULL THEN 'already_queued'
      WHEN COALESCE(sc.gclid, sc.wbraid, sc.gbraid) IS NULL THEN 'missing_click_id'
      WHEN b.confirmed_at IS NULL THEN 'not_export_eligible'
      ELSE 'enqueue_via_app_ssot'
    END AS repair_decision
  FROM base b
  LEFT JOIN queue_presence qp
    ON qp.call_id = b.call_id
   AND qp.site_id = b.site_id
  LEFT JOIN session_clicks sc
    ON sc.session_id = b.matched_session_id
   AND sc.site_id = b.site_id
)
SELECT
  site_id,
  call_id,
  status,
  oci_status,
  confirmed_at,
  gclid,
  wbraid,
  gbraid,
  repair_decision
FROM candidates
ORDER BY confirmed_at DESC NULLS LAST;

-- [STEP 2] Operator summary
WITH dry_run AS (
  SELECT * FROM (
    WITH base AS (
      SELECT c.id AS call_id, c.site_id, c.status, c.oci_status, c.confirmed_at, c.matched_session_id
      FROM public.calls c
      WHERE (c.status = 'won' OR c.oci_status = 'sealed')
    ),
    queue_presence AS (
      SELECT DISTINCT q.call_id, q.site_id FROM public.offline_conversion_queue q
    ),
    session_clicks AS (
      SELECT s.id AS session_id, s.site_id, s.gclid, s.wbraid, s.gbraid FROM public.sessions s
    )
    SELECT
      b.site_id,
      CASE
        WHEN b.call_id IS NULL THEN 'missing_call_id'
        WHEN b.site_id IS NULL THEN 'missing_site_id'
        WHEN qp.call_id IS NOT NULL THEN 'already_queued'
        WHEN COALESCE(sc.gclid, sc.wbraid, sc.gbraid) IS NULL THEN 'missing_click_id'
        WHEN b.confirmed_at IS NULL THEN 'not_export_eligible'
        ELSE 'enqueue_via_app_ssot'
      END AS repair_decision
    FROM base b
    LEFT JOIN queue_presence qp ON qp.call_id = b.call_id AND qp.site_id = b.site_id
    LEFT JOIN session_clicks sc ON sc.session_id = b.matched_session_id AND sc.site_id = b.site_id
  ) x
)
SELECT
  site_id,
  repair_decision,
  COUNT(*)::int AS row_count
FROM dry_run
GROUP BY site_id, repair_decision
ORDER BY row_count DESC, site_id, repair_decision;

-- [STEP 3] Repair guidance (no blind insert)
-- For rows where repair_decision='enqueue_via_app_ssot':
--   trigger app-side sweeper:
--     POST /api/cron/sweep-unsent-conversions  (with cron secret)
--   or run the same enqueueSealConversion path in a controlled script.
--
-- Safe transaction guidance:
-- - Keep this playbook in read-only mode.
-- - If emergency writes are needed, execute in explicit transaction per site and verify row counts before COMMIT.
