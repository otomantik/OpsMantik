# Intent Olmayan Hesap Tanı SQL Sorguları

**Sorun:** Hiçbir hesapta intent görünmüyor.

**Kaynak:** Intent'ler `public.calls` tablosunda `source = 'click'` ve `status IN ('intent', NULL)` satırlarıdır. Bunlar `ensure_session_intent_v1` RPC ile sync pipeline'dan oluşturulur.

---

## 1. Genel Özet (Tüm Hesaplar)

```sql
-- Tüm sitelerde intent/call sayısı (site bazlı)
SELECT
  s.id AS site_id,
  s.name AS site_name,
  COUNT(*) FILTER (WHERE c.source = 'click' AND (c.status IS NULL OR c.status = 'intent')) AS pending_intents,
  COUNT(*) FILTER (WHERE c.source = 'click') AS total_click_calls,
  COUNT(*) FILTER (WHERE c.source != 'click' OR c.source IS NULL) AS other_calls,
  COUNT(*) AS total_calls
FROM public.sites s
LEFT JOIN public.calls c ON c.site_id = s.id
GROUP BY s.id, s.name
ORDER BY total_calls DESC;
```

---

## 2. Hiç Intent Var mı? (Global)

```sql
-- Tüm DB'de source='click' olan kaç kayıt var?
SELECT COUNT(*) AS click_intent_count
FROM public.calls
WHERE source = 'click';

-- Status dağılımı (click kayıtları)
SELECT
  status,
  COUNT(*) AS cnt
FROM public.calls
WHERE source = 'click'
GROUP BY status
ORDER BY cnt DESC;
```

---

## 3. Pipeline Kaynağı: Events (phone/whatsapp tıklamaları)

Intent'ler `ensure_session_intent_v1` ile oluşur. Bu RPC, sync pipeline'dan `event_category = 'conversion'` ve `event_action IN ('phone_call', 'whatsapp_click', ...)` eventleri geldiğinde çağrılır.

```sql
-- Son 7 günde conversion eventleri var mı? (Intent bu eventlerden oluşur)
-- event_action: phone_call, phone_click, call_click, tel_click, whatsapp, whatsapp_click, wa_click, joinchat
SELECT
  site_id,
  event_category,
  event_action,
  COUNT(*) AS cnt,
  MIN(created_at) AS min_ts,
  MAX(created_at) AS max_ts
FROM public.events
WHERE created_at >= now() - interval '7 days'
  AND (
    event_category = 'conversion'
    OR event_action IN ('phone_call', 'phone_click', 'call_click', 'tel_click', 'whatsapp', 'whatsapp_click', 'wa_click', 'joinchat')
  )
GROUP BY site_id, event_category, event_action
ORDER BY cnt DESC;
```

```sql
-- Event kategorileri dağılımı (son 7 gün)
SELECT
  event_category,
  event_action,
  COUNT(*) AS cnt
FROM public.events
WHERE created_at >= now() - interval '7 days'
GROUP BY event_category, event_action
ORDER BY cnt DESC;
```

---

## 4. Session Var mı? (Intent session_id ister)

`ensure_session_intent_v1` çağrılırken `matched_session_id` gerekir. Session yoksa intent oluşmaz.

```sql
-- Son 7 günde site bazlı session sayısı
SELECT
  site_id,
  COUNT(*) AS session_count,
  MIN(created_at) AS min_ts,
  MAX(created_at) AS max_ts
FROM public.sessions
WHERE created_at >= now() - interval '7 days'
GROUP BY site_id
ORDER BY session_count DESC;
```

---

## 5. Pipeline Zinciri Kontrolü

```sql
-- processed_signals: Event işlendi mi? (idempotency ledger)
SELECT
  site_id,
  status,
  COUNT(*) AS cnt
FROM public.processed_signals
WHERE received_at >= now() - interval '7 days'
GROUP BY site_id, status;
```

```sql
-- sync_dlq: Başarısız işlenen eventler var mı?
SELECT
  site_id,
  stage,
  error,
  COUNT(*) AS cnt
FROM public.sync_dlq
WHERE created_at >= now() - interval '7 days'
GROUP BY site_id, stage, error
ORDER BY cnt DESC;
```

---

## 6. Site/Script Yüklü mü? (Tracker entegrasyonu)

Intent oluşması için:
1. Site'da script yüklü olmalı (tracker)
2. Kullanıcı phone/whatsapp tıklamalı
3. Event sync API'ye gidip pipeline'dan geçmeli

```sql
-- Siteler ve son event/session/call zamanları
SELECT
  s.id,
  s.name,
  (SELECT MAX(created_at) FROM public.events e WHERE e.site_id = s.id) AS last_event_at,
  (SELECT MAX(created_at) FROM public.sessions s2 WHERE s2.site_id = s.id) AS last_session_at,
  (SELECT MAX(created_at) FROM public.calls c WHERE c.site_id = s.id) AS last_call_at
FROM public.sites s
ORDER BY last_event_at DESC NULLS LAST;
```

---

## 7. Tek Satırda "Neden Intent Yok?" Özeti

```sql
SELECT
  (SELECT COUNT(*) FROM public.calls WHERE source = 'click') AS total_click_intents,
  (SELECT COUNT(*) FROM public.events WHERE created_at >= now() - interval '7 days' AND event_category = 'conversion') AS conversion_events_7d,
  (SELECT COUNT(*) FROM public.sessions WHERE created_at >= now() - interval '7 days') AS sessions_7d,
  (SELECT COUNT(*) FROM public.sync_dlq WHERE created_at >= now() - interval '7 days') AS dlq_failures_7d;
```

---

## Olası Kök Nedenler

| Durum | Olası sebep |
|-------|-------------|
| `total_click_intents = 0` | Hiç intent oluşmamış |
| `conversion_events_7d = 0` | Script phone/whatsapp event göndermiyor veya `event_category`/`event_action` yanlış |
| `sessions_7d = 0` | Session oluşmuyor; intent session'a bağlı |
| `dlq_failures_7d > 0` | Sync pipeline hata veriyor; DLQ'de hata detayı var |
| Event var ama intent yok | `intent-service` / `ensure_session_intent_v1` çağrılmıyor veya hata veriyor |

Bu sorguları Supabase SQL Editor'da çalıştırarak hangi aşamada koptuğunu tespit edebilirsin.
