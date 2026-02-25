-- =============================================================================
-- Scoring V1.1 — Post-launch monitoring (Lansman sonrası izleme)
-- Run in Supabase SQL Editor or psql. Adjust time window as needed.
-- =============================================================================
--
-- Fail-open izleme (Sentry/Datadog): call_scores yazma best-effort olduğu için
-- log event "call_scores_audit_insert_failed" için hafif bir alarm kurun.
-- Alarm çok ötmeye başlarsa RLS veya şema kayması (drift) araştırın.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Son N saatte V1.1 ile skorlanan çağrılar: suspicious vs intent dağılımı
--    (120 saniye / 50 güven barajı gerçek dünyada nasıl performans gösteriyor)
-- -----------------------------------------------------------------------------
WITH v1_1_calls AS (
  SELECT
    c.id,
    c.site_id,
    c.created_at,
    c.lead_score,
    c.confidence_score,
    (c.score_breakdown->>'elapsedSeconds')::numeric AS elapsed_seconds,
    CASE
      WHEN c.confidence_score IS NULL THEN 'legacy'
      WHEN (c.score_breakdown->>'elapsedSeconds')::numeric < 120 THEN 'suspicious'
      WHEN c.confidence_score < 50 THEN 'suspicious'
      ELSE 'intent'
    END AS derived_status
  FROM public.calls c
  WHERE c.created_at >= now() - interval '6 hours'
    AND (
      c.confidence_score IS NOT NULL
      OR (c.score_breakdown->>'version') = 'v1.1'
    )
)
SELECT
  derived_status,
  count(*) AS call_count,
  round(100.0 * count(*) / nullif(sum(count(*)) OVER (), 0), 1) AS pct
FROM v1_1_calls
GROUP BY derived_status
ORDER BY call_count DESC;


-- -----------------------------------------------------------------------------
-- 2) Saatlik özet (son 24 saat): suspicious vs intent zaman serisi
-- -----------------------------------------------------------------------------
WITH v1_1_calls AS (
  SELECT
    date_trunc('hour', c.created_at) AS hour_utc,
    CASE
      WHEN c.confidence_score IS NULL THEN 'legacy'
      WHEN (c.score_breakdown->>'elapsedSeconds')::numeric < 120 THEN 'suspicious'
      WHEN c.confidence_score < 50 THEN 'suspicious'
      ELSE 'intent'
    END AS derived_status
  FROM public.calls c
  WHERE c.created_at >= now() - interval '24 hours'
    AND (c.confidence_score IS NOT NULL OR (c.score_breakdown->>'version') = 'v1.1')
)
SELECT
  hour_utc,
  derived_status,
  count(*) AS calls
FROM v1_1_calls
GROUP BY hour_utc, derived_status
ORDER BY hour_utc DESC, calls DESC;


-- -----------------------------------------------------------------------------
-- 3) call_scores audit tablosu yazılıyor mu? (best-effort insert kontrolü)
--    Eğer calls ile call_scores satır sayısı ciddi farklıysa RLS/drift araştır.
-- -----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.calls c
   WHERE c.created_at >= now() - interval '6 hours'
     AND (c.confidence_score IS NOT NULL OR (c.score_breakdown->>'version') = 'v1.1')) AS v1_1_calls_last_6h,
  (SELECT count(*) FROM public.call_scores cs
   WHERE cs.created_at >= now() - interval '6 hours') AS call_scores_rows_last_6h;


-- -----------------------------------------------------------------------------
-- 4) Site bazında kısa özet (hangi site’ta kaç suspicious / intent)
-- -----------------------------------------------------------------------------
WITH v1_1_calls AS (
  SELECT
    c.site_id,
    CASE
      WHEN c.confidence_score IS NULL THEN 'legacy'
      WHEN (c.score_breakdown->>'elapsedSeconds')::numeric < 120 THEN 'suspicious'
      WHEN c.confidence_score < 50 THEN 'suspicious'
      ELSE 'intent'
    END AS derived_status
  FROM public.calls c
  WHERE c.created_at >= now() - interval '6 hours'
    AND (c.confidence_score IS NOT NULL OR (c.score_breakdown->>'version') = 'v1.1')
)
SELECT
  site_id,
  derived_status,
  count(*) AS calls
FROM v1_1_calls
GROUP BY site_id, derived_status
ORDER BY site_id, derived_status;
