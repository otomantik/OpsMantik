-- =============================================================================
-- Antika İstanbul / Poyraz Antika: Intent'ler consolada kaydedir ama canlı kuyrukta yok
-- Teşhis: Partition hatası + intent/call akışı kontrolü
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Site bul (Antika İstanbul veya Poyraz Antika)
-- -----------------------------------------------------------------------------
SELECT id, public_id, name, domain
FROM sites
WHERE name ILIKE '%antika%' OR name ILIKE '%istanbul%' OR domain ILIKE '%poyrazantika%'
ORDER BY created_at DESC;

-- Poyraz Antika: site_id = 01d24667-ca9a-44e3-ab7a-7cd171ae653f

-- -----------------------------------------------------------------------------
-- 2) sync_dlq: Sync worker partition hatası (işlenemedi, DLQ'ya düştü)
-- -----------------------------------------------------------------------------
SELECT id, site_id, received_at, stage, error, 
       (payload->>'s')::text AS site_public_id,
       (payload->>'ingest_id')::text AS ingest_id
FROM sync_dlq
WHERE site_id = '01d24667-ca9a-44e3-ab7a-7cd171ae653f'::uuid
   OR (payload->>'s')::text ILIKE '%antika%'
ORDER BY received_at DESC
LIMIT 20;

-- Hata: "moving row to another partition during a BEFORE FOR EACH ROW trigger is not supported"
-- → Event insert başarısız; intent hiç oluşmuyor.

-- -----------------------------------------------------------------------------
-- 3) processed_signals: Başarısız işlenen eventler (status = 'failed')
-- -----------------------------------------------------------------------------
SELECT event_id, site_id, status, 
       -- created_at yoksa: processed_signals tablosunda olabilir
       NULL AS note
FROM processed_signals
WHERE site_id = '01d24667-ca9a-44e3-ab7a-7cd171ae653f'::uuid
  AND status = 'failed'
ORDER BY event_id DESC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 4) Bugünkü intent'ler (calls tablosu — consolada gördüğün)
-- -----------------------------------------------------------------------------
SELECT id, site_id, status, matched_session_id, intent_action, created_at
FROM calls
WHERE site_id = '01d24667-ca9a-44e3-ab7a-7cd171ae653f'::uuid
  AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
ORDER BY created_at DESC
LIMIT 30;

-- -----------------------------------------------------------------------------
-- 5) get_recent_intents_lite_v1 ile canlı kuyruk verisi (bugün + dün)
-- -----------------------------------------------------------------------------
SELECT public.get_recent_intents_lite_v1(
  '01d24667-ca9a-44e3-ab7a-7cd171ae653f'::uuid,
  (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')::timestamptz,
  (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') + interval '2 days')::timestamptz,
  50,
  false  -- ads_only: false = tüm intent'ler
) AS queue_result;

-- -----------------------------------------------------------------------------
-- 6) Partition drift: Sessions/events created_month uyumsuzluğu
-- Şubat/Mart geçişinde trigger, created_at'tan farklı month hesaplarsa hata olur.
-- -----------------------------------------------------------------------------
-- Mevcut partition'lar
SELECT child.relname AS partition_name,
       pg_get_expr(child.relpartbound, child.oid) AS partition_range
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname IN ('sessions', 'events')
ORDER BY parent.relname, child.relname;

-- -----------------------------------------------------------------------------
-- 7) ÖZET ve Olası Nedenler
-- -----------------------------------------------------------------------------
-- A) sync_worker "moving row to another partition" hatası:
--    - events tablosuna insert yapılırken BEFORE trigger (events_set_session_month_from_session)
--    - session_month değeri insert edilen partition ile uyuşmuyor
--    - Çözüm: create_next_month_partitions() çalıştır; Mart partition varsa kontrol et
--
-- B) Console'da görünen vs kuyrukta olmayan:
--    - "Console" = calls tablosu veya realtime signal (event gelmiş ama işlenmemiş)
--    - "Canlı kuyruk" = get_recent_intents_lite_v1 (sessions + calls JOIN)
--    - Eğer event insert FAIL ederse → session/event yok → get_recent_intents döndürmez
--    - Calls doğrudan call-event API'den gelir; sync event'ten gelen intent'ler
--      IntentService.handleIntent → ensure_session_intent_v1 ile calls'a yazılır
--    - Sync worker patlarsa: event yazılmaz, handleIntent çağrılmaz, intent oluşmaz
--
-- C) Hemen denenecek adımlar:
--    1) Mart partition oluştur: SELECT public.create_next_month_partitions();
--    2) Drift kontrol: SELECT * FROM public.watchtower_partition_drift_check_v1();
