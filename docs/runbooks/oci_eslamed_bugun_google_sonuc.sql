-- =============================================================================
-- Eslamed: Bugün Google'a gidip dönüş veya hata alan kayıtlar — tüm data
-- Supabase SQL Editor'da çalıştır.
-- Site: Eslamed (b1264552-c859-40cb-a3fb-0ba057afd070)
-- =============================================================================

-- COMPLETED = dönüş aldı (uploaded_at set)
-- FAILED / RETRY = hata aldı (provider_error_code, last_error set)
-- Filtre: bugün uploaded_at veya bugün FAILED/RETRY'ye güncellenmiş
SELECT
  oq.id AS queue_id,
  oq.call_id,
  oq.sale_id,
  oq.session_id,
  oq.status AS queue_status,
  oq.provider_key,
  oq.conversion_time,
  oq.value_cents,
  oq.currency,
  oq.gclid,
  oq.wbraid,
  oq.gbraid,
  oq.attempt_count,
  oq.claimed_at,
  oq.uploaded_at AS google_a_gonderim_zamani,
  oq.provider_request_id,
  oq.provider_error_code,
  oq.provider_error_category,
  oq.last_error,
  oq.created_at,
  oq.updated_at,
  c.confirmed_at AS muhur_zamani,
  c.lead_score,
  c.sale_amount,
  c.status AS call_status,
  sess.gclid AS session_gclid,
  sess.wbraid AS session_wbraid,
  sess.gbraid AS session_gbraid
FROM offline_conversion_queue oq
LEFT JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
LEFT JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND (
    (oq.uploaded_at IS NOT NULL AND oq.uploaded_at::date = CURRENT_DATE)   /* dönüş aldı */
    OR (oq.status IN ('FAILED', 'RETRY') AND oq.updated_at::date = CURRENT_DATE)   /* hata aldı */
  )
ORDER BY COALESCE(oq.uploaded_at, oq.updated_at) DESC;


-- -----------------------------------------------------------------------------
-- Alternatif: Bugün oluşturulan veya güncellenen tüm Eslamed queue kayıtları
-- (daha geniş — created_at veya updated_at bugün)
-- -----------------------------------------------------------------------------
/*
SELECT oq.*, c.confirmed_at, c.lead_score, c.sale_amount
FROM offline_conversion_queue oq
LEFT JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND (oq.created_at::date = CURRENT_DATE OR oq.updated_at::date = CURRENT_DATE)
ORDER BY oq.updated_at DESC;
*/
