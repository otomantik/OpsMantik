-- =============================================================================
-- Muratcan Akü: GCLID Audit — Ghost oranı, early-call latency, GCLID consistency
-- Supabase SQL Editor'da çalıştır.
-- Site: Muratcan (c644fff7-9d7a-440d-b9bf-99f3a0f86073)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) GHOST ORANI — Rome/Amsterdam IP geo + GCLID var = yanlış şehir gösteriliyor
--    Oran = ghost_count / total_gclid_calls
-- -----------------------------------------------------------------------------
WITH gclid_calls AS (
  SELECT c.id, c.matched_session_id, c.site_id, sess.city AS session_city
  FROM calls c
  LEFT JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
  WHERE c.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
    AND (c.gclid IS NOT NULL OR sess.gclid IS NOT NULL)
    AND c.matched_at >= (current_date - interval '30 days')
),
ghost AS (
  SELECT COUNT(*) AS cnt
  FROM gclid_calls
  WHERE session_city IN ('Rome', 'Amsterdam', 'Roma')
)
SELECT
  (SELECT COUNT(*) FROM gclid_calls) AS total_gclid_calls,
  (SELECT cnt FROM ghost) AS ghost_count,
  ROUND(
    100.0 * (SELECT cnt FROM ghost) / NULLIF((SELECT COUNT(*) FROM gclid_calls), 0),
    2
  ) AS ghost_rate_pct;


-- -----------------------------------------------------------------------------
-- 2) EARLY-CALL LATENCY — Sync (ilk event) vs Call event zaman farkı
--    Negatif veya <5 sn = early call riski (sync henüz GCLID yazmamış olabilir)
-- -----------------------------------------------------------------------------
WITH first_event AS (
  SELECT
    e.session_id,
    e.site_id,
    MIN(e.created_at) AS first_sync_at
  FROM events e
  WHERE e.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
    AND e.session_month >= (current_date - interval '2 months')::date
  GROUP BY e.session_id, e.site_id
),
call_latency AS (
  SELECT
    c.id AS call_id,
    c.matched_at AS call_at,
    fe.first_sync_at,
    EXTRACT(EPOCH FROM (c.matched_at - fe.first_sync_at))::int AS latency_sec
  FROM calls c
  JOIN first_event fe
    ON fe.session_id = c.matched_session_id AND fe.site_id = c.site_id
  WHERE c.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
    AND c.matched_at >= (current_date - interval '30 days')
)
SELECT
  COUNT(*) AS total_calls,
  COUNT(*) FILTER (WHERE latency_sec < 0) AS early_call_negative,
  COUNT(*) FILTER (WHERE latency_sec >= 0 AND latency_sec < 5) AS early_call_under_5s,
  ROUND(AVG(latency_sec) FILTER (WHERE latency_sec >= 0), 1) AS avg_latency_sec
FROM call_latency;


-- -----------------------------------------------------------------------------
-- 3) GCLID CONSISTENCY — calls vs sessions GCLID uyumu
--    Mismatch = call'da var session'da yok veya tersi
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*) AS total_calls,
  COUNT(*) FILTER (WHERE (c.gclid IS NOT NULL OR c.wbraid IS NOT NULL OR c.gbraid IS NOT NULL)
    AND (sess.gclid IS NULL AND sess.wbraid IS NULL AND sess.gbraid IS NULL)) AS call_has_session_missing,
  COUNT(*) FILTER (WHERE (c.gclid IS NULL AND c.wbraid IS NULL AND c.gbraid IS NULL)
    AND (sess.gclid IS NOT NULL OR sess.wbraid IS NOT NULL OR sess.gbraid IS NOT NULL)) AS session_has_call_missing
FROM calls c
LEFT JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE c.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
  AND c.matched_at >= (current_date - interval '30 days');


-- -----------------------------------------------------------------------------
-- 4) GHOST KAYITLAR DETAY — Rome/Amsterdam session city + GCLID dolu call'lar
-- -----------------------------------------------------------------------------
SELECT
  c.id AS call_id,
  c.matched_at,
  c.district_name AS call_district,
  c.location_source AS call_location_source,
  sess.city AS session_city,
  sess.district AS session_district
FROM calls c
JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE c.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
  AND sess.city IN ('Rome', 'Amsterdam', 'Roma')
  AND (c.gclid IS NOT NULL OR sess.gclid IS NOT NULL)
  AND c.matched_at >= (current_date - interval '30 days')
ORDER BY c.matched_at DESC
LIMIT 50;
