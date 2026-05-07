-- @pack_id: export_closure_stage_journal_gap
-- @contract_version: v1
-- @db_required: true
-- @red_green_criteria: RED when stage_journal_gap_calls > 0 — G1 call (session click id) in last lookback window with four-tuple panel status but no offline_conversion_queue row with matching action for that call_id. Heuristic: calls.status may lag IntentSealed/outbox; use as SRE smoke + drill-down list, not sole proof of funnel correctness.

-- Mutabakat (best-effort): lead.stage (calls.status) ↔ beklenen OpsMantik_* journal action satırı.

WITH
params AS (
  SELECT 30::int AS lookback_days
),
g1_calls AS (
  SELECT
    c.site_id,
    c.id AS call_id,
    CASE lower(trim(c.status))
      WHEN 'junk' THEN 'OpsMantik_Junk_Exclusion'::text
      WHEN 'contacted' THEN 'OpsMantik_Contacted'::text
      WHEN 'offered' THEN 'OpsMantik_Offered'::text
      WHEN 'won' THEN 'OpsMantik_Won'::text
      WHEN 'confirmed' THEN 'OpsMantik_Won'::text
      ELSE NULL::text
    END AS expected_action
  FROM public.calls c
  INNER JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
  CROSS JOIN params p
  WHERE c.matched_session_id IS NOT NULL
    AND coalesce(nullif(trim(s.gclid), ''), nullif(trim(s.wbraid), ''), nullif(trim(s.gbraid), '')) IS NOT NULL
    AND lower(trim(c.status)) = ANY (
      ARRAY['junk'::text, 'contacted'::text, 'offered'::text, 'won'::text, 'confirmed'::text]
    )
    AND c.updated_at >= (now() - ((SELECT lookback_days FROM params) || ' days')::interval)
),
expected AS (
  SELECT site_id, call_id, expected_action
  FROM g1_calls
  WHERE expected_action IS NOT NULL
),
missing AS (
  SELECT e.site_id, e.call_id
  FROM expected e
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.offline_conversion_queue q
    WHERE q.site_id = e.site_id
      AND q.call_id = e.call_id
      AND q.provider_key = 'google_ads'
      AND q.action = e.expected_action
  )
),
agg AS (
  SELECT site_id, count(*)::bigint AS stage_journal_gap_calls
  FROM missing
  GROUP BY site_id
),
sites AS (
  SELECT DISTINCT x.site_id
  FROM (
    SELECT site_id FROM agg
    UNION
    SELECT DISTINCT q.site_id
    FROM public.offline_conversion_queue q
    WHERE q.provider_key = 'google_ads'
  ) x
)
SELECT
  s.site_id,
  COALESCE(a.stage_journal_gap_calls, 0::bigint) AS stage_journal_gap_calls,
  CASE
    WHEN COALESCE(a.stage_journal_gap_calls, 0) > 0 THEN 'RED'::text
    ELSE 'GREEN'::text
  END AS contract_status,
  CASE
    WHEN COALESCE(a.stage_journal_gap_calls, 0) > 0 THEN ARRAY['STAGE_JOURNAL_GAP_G1']::text[]
    ELSE ARRAY[]::text[]
  END AS blocking_reasons
FROM sites s
LEFT JOIN agg a ON a.site_id = s.site_id;
