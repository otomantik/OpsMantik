-- @pack_id: orphan_won_backfill
-- @contract_version: v2
-- @db_required: true
-- @red_green_criteria: DRY-RUN only. No DML. Site-scoped repair required.
-- Read-only candidate discovery for won/sealed pipeline orphans.
-- Canonical write path is app-side enqueueSealConversion; this SQL intentionally performs no writes.

WITH won_or_sealed AS (
  SELECT
    c.site_id,
    c.id AS call_id,
    c.matched_session_id AS session_id,
    c.caller_phone_e164,
    c.status,
    c.oci_status,
    c.confirmed_at,
    c.created_at,
    c.updated_at,
    c.sale_amount AS actual_revenue,
    NULL::text AS currency,
    c.lead_score
  FROM public.calls c
  JOIN public.sites s ON s.id = c.site_id
  WHERE (c.status = 'won' OR c.oci_status = 'sealed')
),
queue_coverage AS (
  SELECT
    q.site_id,
    q.call_id,
    BOOL_OR(q.action = 'OpsMantik_Won') AS has_won_action,
    BOOL_OR(q.status IN ('QUEUED', 'RETRY', 'PROCESSING', 'BLOCKED_PRECEDING_SIGNALS')) AS has_active_pipeline,
    BOOL_OR(q.status IN ('COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED')) AS has_completed_pipeline,
    BOOL_OR(q.status IN ('FAILED', 'DEAD_LETTER_QUARANTINE', 'VOIDED_BY_REVERSAL')) AS has_terminal_pipeline
  FROM public.offline_conversion_queue q
  WHERE q.call_id IS NOT NULL
  GROUP BY q.site_id, q.call_id
),
session_clicks AS (
  SELECT
    s.site_id,
    s.id AS session_id,
    NULLIF(trim(s.gclid), '') AS gclid,
    NULLIF(trim(s.wbraid), '') AS wbraid,
    NULLIF(trim(s.gbraid), '') AS gbraid
  FROM public.sessions s
),
consent_snapshot AS (
  SELECT
    w.site_id,
    w.call_id,
    COALESCE((r.consent_scopes @> ARRAY['marketing']::text[]), false) AS has_marketing_consent
  FROM won_or_sealed w
  LEFT JOIN LATERAL public.get_call_session_for_oci(w.call_id, w.site_id) r ON true
),
orphans AS (
  SELECT
    w.site_id,
    w.call_id,
    w.session_id,
    w.caller_phone_e164,
    w.status,
    w.oci_status,
    w.confirmed_at,
    w.created_at,
    w.updated_at,
    w.actual_revenue,
    w.currency,
    w.lead_score,
    sc.gclid,
    sc.wbraid,
    sc.gbraid,
    cs.has_marketing_consent,
    qc.has_won_action,
    qc.has_active_pipeline,
    qc.has_completed_pipeline,
    qc.has_terminal_pipeline
  FROM won_or_sealed w
  LEFT JOIN queue_coverage qc
    ON qc.site_id = w.site_id
   AND qc.call_id = w.call_id
  LEFT JOIN session_clicks sc
    ON sc.site_id = w.site_id
   AND sc.session_id = w.session_id
  LEFT JOIN consent_snapshot cs
    ON cs.site_id = w.site_id
   AND cs.call_id = w.call_id
  WHERE COALESCE(qc.has_active_pipeline, false) = false
    AND COALESCE(qc.has_completed_pipeline, false) = false
),
classified AS (
  SELECT
    o.*,
    CASE
      WHEN o.confirmed_at IS NULL THEN 'NEEDS_OPERATOR_REVIEW'
      WHEN o.has_marketing_consent = false THEN 'BLOCKED_CONSENT_MISSING'
      WHEN COALESCE(o.gclid, o.wbraid, o.gbraid) IS NULL THEN 'BLOCKED_MISSING_CLICK_ID'
      ELSE 'ENQUEUEABLE'
    END AS repair_class,
    CASE
      WHEN o.confirmed_at IS NULL THEN 'REVIEW_NOT_EXPORT_ELIGIBLE'
      WHEN o.has_marketing_consent = false THEN 'CONSENT_MISSING'
      WHEN COALESCE(o.gclid, o.wbraid, o.gbraid) IS NULL THEN 'MISSING_CLICK_ID'
      ELSE 'ENQUEUEABLE'
    END AS reason_code
  FROM orphans o
)
SELECT
  c.site_id,
  c.call_id,
  CASE
    WHEN c.repair_class = 'ENQUEUEABLE' THEN 'ENQUEUE_VIA_APP_SSOT'
    WHEN c.repair_class = 'BLOCKED_MISSING_CLICK_ID' THEN 'ENQUEUE_BLOCKED_VIA_APP_SSOT'
    WHEN c.repair_class = 'BLOCKED_CONSENT_MISSING' THEN 'ENQUEUE_FAILED_DETERMINISTIC_SKIP_VIA_APP_SSOT'
    ELSE 'OPERATOR_REVIEW_REQUIRED'
  END AS expected_action,
  c.repair_class,
  c.reason_code,
  CASE WHEN c.repair_class IN ('ENQUEUEABLE', 'BLOCKED_MISSING_CLICK_ID', 'BLOCKED_CONSENT_MISSING') THEN 1 ELSE 0 END AS can_auto_repair,
  jsonb_build_object(
    'status', c.status,
    'oci_status', c.oci_status,
    'session_id', c.session_id,
    'caller_phone_e164', c.caller_phone_e164,
    'gclid', c.gclid,
    'wbraid', c.wbraid,
    'gbraid', c.gbraid,
    'has_marketing_consent', c.has_marketing_consent,
    'actual_revenue', c.actual_revenue,
    'currency', c.currency,
    'lead_score', c.lead_score,
    'confirmed_at', c.confirmed_at,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'has_won_action', c.has_won_action,
    'has_terminal_pipeline', c.has_terminal_pipeline
  ) AS evidence
FROM classified c
ORDER BY c.site_id, c.confirmed_at DESC NULLS LAST, c.call_id;
