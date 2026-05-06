-- Smoke check for rebuild_call_projection RPC
-- Usage:
--   1) Ensure projection table migration is applied.
--   2) Run and verify rpc_status='rebuilt' for at least one canary.

WITH canary AS (
  SELECT
    l.call_id,
    l.site_id
  FROM public.call_funnel_ledger l
  ORDER BY l.created_at DESC
  LIMIT 1
)
SELECT
  (to_regclass('public.call_funnel_projection') IS NOT NULL) AS projection_table_exists,
  c.site_id,
  c.call_id,
  public.rebuild_call_projection(c.call_id, c.site_id) AS rpc_result,
  public.rebuild_call_projection(c.call_id, c.site_id)->>'status' AS rpc_status
FROM canary c;
