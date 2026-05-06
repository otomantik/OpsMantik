-- Value integrity health (read-only)
-- Focused on won queue rows used for conversion export.

WITH won_rows AS (
  SELECT
    q.site_id,
    q.id,
    q.value_cents,
    q.actual_revenue,
    q.entry_reason
  FROM public.offline_conversion_queue q
  WHERE q.action = 'OpsMantik_Won'
),
agg AS (
  SELECT
    w.site_id,
    COUNT(*)::int AS total_won_rows,
    COUNT(*) FILTER (WHERE w.value_cents IN (960, 1000))::int AS fallback_only_value_count,
    COUNT(*) FILTER (WHERE w.actual_revenue IS NOT NULL)::int AS actual_revenue_present_count,
    COUNT(*) FILTER (WHERE w.value_cents IS NULL OR w.value_cents <= 0)::int AS suspicious_zero_or_null_value_count
  FROM won_rows w
  GROUP BY w.site_id
)
SELECT
  s.id AS site_id,
  s.name AS site_name,
  COALESCE(a.total_won_rows, 0) AS total_won_rows,
  COALESCE(a.fallback_only_value_count, 0) AS fallback_only_value_count,
  COALESCE(a.actual_revenue_present_count, 0) AS actual_revenue_present_count,
  COALESCE(
    ROUND(a.fallback_only_value_count::numeric / NULLIF(a.total_won_rows, 0)::numeric, 4),
    0
  ) AS fallback_ratio,
  COALESCE(a.suspicious_zero_or_null_value_count, 0) AS suspicious_zero_or_null_value_count
FROM public.sites s
LEFT JOIN agg a
  ON a.site_id = s.id
ORDER BY fallback_ratio DESC, total_won_rows DESC, s.name ASC;
