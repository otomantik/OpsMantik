-- @pack_id: export_closure_reconciliation_probe
-- @contract_version: v1
-- @db_required: true
-- @red_green_criteria: RED when dual_path_overlap_calls > 0 — same call_id has PENDING marketing_signals while an active google_ads journal row exists (W3 dual-surface smell during S2 drain). S1 strict + drained backlog should trend GREEN.

-- Mutabakat köprüsü (read-only): çift yüzey örtüşmesi — lead başına hem legacy PENDING sinyal hem aktif kuyruk satırı.
-- Tam “beklenen 4’lü küme” politikası ayrı tablolarda tanımlanır; bu paket operasyonel kokuyu gösterir.

WITH overlap AS (
  SELECT
    ms.site_id,
    ms.call_id
  FROM public.marketing_signals ms
  INNER JOIN public.offline_conversion_queue q
    ON q.site_id = ms.site_id
   AND q.call_id = ms.call_id
   AND q.provider_key = 'google_ads'
  WHERE ms.dispatch_status = 'PENDING'
    AND ms.call_id IS NOT NULL
    AND q.status = ANY (ARRAY['QUEUED'::text, 'RETRY'::text, 'PROCESSING'::text])
  GROUP BY ms.site_id, ms.call_id
),
agg AS (
  SELECT site_id, count(*)::bigint AS dual_path_overlap_calls
  FROM overlap
  GROUP BY site_id
),
sites AS (
  SELECT DISTINCT q.site_id
  FROM public.offline_conversion_queue q
  WHERE q.provider_key = 'google_ads'
)
SELECT
  s.site_id,
  COALESCE(a.dual_path_overlap_calls, 0::bigint) AS dual_path_overlap_calls,
  CASE
    WHEN COALESCE(a.dual_path_overlap_calls, 0) > 0 THEN 'RED'::text
    ELSE 'GREEN'::text
  END AS contract_status,
  CASE
    WHEN COALESCE(a.dual_path_overlap_calls, 0) > 0
      THEN ARRAY['DUAL_PATH_PENDING_AND_JOURNAL_ACTIVE']::text[]
    ELSE ARRAY[]::text[]
  END AS blocking_reasons
FROM sites s
LEFT JOIN agg a ON a.site_id = s.site_id;
