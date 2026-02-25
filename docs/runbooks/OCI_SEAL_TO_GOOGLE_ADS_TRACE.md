# Eslamed OCI: Mühür → Google Ads Script (0 upload neden?)

Bu dokümanda **mühür vurduğun verinin** neden script’te "0 records to upload" döndüğünü adım adım kontrol edebilirsin.

---

## 1. Veri akışı (kısa yol)

```
[War Room: Mühür]  →  POST /api/calls/[id]/seal
       ↓
  Call güncellenir (status=confirmed, oci_status=sealed)
       ↓
  enqueueSealConversion({ callId, siteId, confirmedAt, saleAmount, currency, leadScore })
       ↓
  ┌─ getPrimarySource(siteId, { callId })  →  call.matched_session_id → sessions.gclid/wbraid/gbraid
  │   Yoksa → enqueued: false, reason: 'no_click_id'
  ├─ hasMarketingConsentForCall(siteId, callId)  →  sessions.consent_scopes içinde 'marketing'
  │   Yoksa → enqueued: false, reason: 'marketing_consent_required'
  └─ INSERT offline_conversion_queue (site_id, call_id, gclid, wbraid, gbraid, status='QUEUED', ...)
       ↓
[Google Ads Script]  →  GET /api/oci/google-ads-export?siteId=81d957f3c7534f53b12ff305f9f07ae7&markAsExported=true
       ↓
  offline_conversion_queue WHERE site_id = <Eslamed UUID> AND status = 'QUEUED' AND provider_key = 'google_ads'
       ↓
  JSON dizi döner; script bulk upload yapar. markAsExported=true ise satırlar PROCESSING yapılır.
```

Yani **kuyrukta QUEUED satır yoksa** script her zaman 0 döner. Kuyrukta satır olması için mühür sırasında **enqueue**’nun başarılı olması gerekir; o da **click ID** ve **marketing consent**’e bağlı.

---

## 2. Production’da kontrol (Supabase SQL)

Eslamed site ID (public_id veya UUID): `81d957f3c7534f53b12ff305f9f07ae7`. Aşağıdakileri **production** Supabase’te çalıştır.

### 2.1 Site var mı?

```sql
SELECT id, name, domain, public_id
FROM sites
WHERE id::text = '81d957f3c7534f53b12ff305f9f07ae7'
   OR public_id = '81d957f3c7534f53b12ff305f9f07ae7';
```

- Bir satır dönmeli; `id` (UUID) sonraki sorgularda `site_id` olarak kullanılacak.

### 2.2 Mühürlenmiş (sealed) call’lar

```sql
-- Eslamed için mühürlenmiş aramalar (site_id = yukarıdaki id)
SELECT c.id, c.site_id, c.matched_session_id, c.status, c.oci_status, c.confirmed_at
FROM calls c
JOIN sites s ON s.id = c.site_id
WHERE (s.public_id = '81d957f3c7534f53b12ff305f9f07ae7' OR s.id::text = '81d957f3c7534f53b12ff305f9f07ae7')
  AND c.status = 'confirmed'
  AND c.oci_status = 'sealed'
ORDER BY c.confirmed_at DESC
LIMIT 20;
```

- Hiç satır yoksa: mühürlenmiş call production’da yok (farklı ortamda mühürlenmiş olabilir).
- Varsa: `matched_session_id` dolu mu bak; boşsa GCLID hiç gelmez → enqueue **no_click_id** ile atlanır.

### 2.3 Session’da click ID var mı?

```sql
-- Yukarıdaki call’ların session’larında gclid/wbraid/gbraid
SELECT s.id AS session_id, s.gclid, s.wbraid, s.gbraid, s.consent_scopes
FROM sessions s
JOIN calls c ON c.matched_session_id = s.id AND c.site_id = s.site_id
JOIN sites st ON st.id = c.site_id
WHERE (st.public_id = '81d957f3c7534f53b12ff305f9f07ae7' OR st.id::text = '81d957f3c7534f53b12ff305f9f07ae7')
  AND c.status = 'confirmed'
  AND c.oci_status = 'sealed'
ORDER BY c.confirmed_at DESC
LIMIT 20;
```

- `gclid`, `wbraid`, `gbraid` hepsi NULL ise → enqueue **no_click_id** olur, kuyruğa hiç düşmez.
- `consent_scopes` içinde `'marketing'` yoksa → enqueue **marketing_consent_required** olur, kuyruğa düşmez.

### 2.4 Kuyrukta QUEUED satır var mı?

```sql
SELECT oq.id, oq.site_id, oq.call_id, oq.status, oq.provider_key, oq.created_at
FROM offline_conversion_queue oq
JOIN sites s ON s.id = oq.site_id
WHERE (s.public_id = '81d957f3c7534f53b12ff305f9f07ae7' OR s.id::text = '81d957f3c7534f53b12ff305f9f07ae7')
ORDER BY oq.created_at DESC
LIMIT 20;
```

- `status = 'QUEUED'` satır yoksa script 0 döner.
- Hepsi `PROCESSING` veya `COMPLETED` ise: script daha önce çalışıp `markAsExported=true` ile almış ve işlemiş demektir; bir sonraki mühürden gelen yeni satırları beklemek gerekir.

---

## 3. 0 upload için olası nedenler

| Kontrol | Sonuç | Ne yapılır |
|--------|--------|------------|
| Session’da gclid/wbraid/gbraid yok | Enqueue **no_click_id** | Tracker/sync ile tıklama verisi (gclid) session’a yazılıyor mu? Eslamed script’i doğru site_id ve event’leri gönderiyor mu? |
| consent_scopes’ta 'marketing' yok | Enqueue **marketing_consent_required** | Kullanıcı marketing consent vermeli; consent’i session’a yazan akışı kontrol et. |
| Kuyrukta satır var ama status ≠ QUEUED | Script zaten işlemiş | Yeni mühür vur; yeni QUEUED satır gelince script tekrar çalışınca dolu döner. |
| Mühürlenmiş call production’da yok | Farklı ortam | Mühürü production’da (canlı War Room) vur veya production DB’ye veriyi taşı. |
| site_id uyuşmazlığı | Export farklı site’a bakıyor | Export route artık id + public_id ile site çözüyor; site 2.1’de bulunuyorsa doğru site_id kullanılıyor. |

---

## 4. Hızlı özet

- **Script 0 diyorsa:** `offline_conversion_queue` içinde Eslamed site’ı için `status = 'QUEUED'` satır yok.
- **QUEUED satır olması için:** Mühür sırasında enqueue’nun çalışması; bunun için **call → matched_session_id → session’da gclid/wbraid/gbraid** ve **session.consent_scopes içinde 'marketing'** gerekir.
- Yukarıdaki SQL’leri production’da çalıştırıp hangi adımda veri eksik/yanlış görünüyor tespit et; buna göre tracker, consent veya mühür ortamını düzelt.
