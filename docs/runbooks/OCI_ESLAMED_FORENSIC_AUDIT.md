# Eslamed OCI Delivery Audit & Log Trace

**Mission:** Forensic audit of Eslamed conversions when 6–7 sealed today but only 1 visible in Google Ads.

---

## 1. Veritabanı Röntgeni (SQL)

**Dosya:** `docs/runbooks/oci_eslamed_forensic_today.sql`

Supabase SQL Editor'da çalıştır. Site: **Eslamed** (`b1264552-c859-40cb-a3fb-0ba057afd070`).

Sorgular:

| # | Amaç | Sonuç |
|---|------|-------|
| 1 | **Lost conversions** | Bugün oluşturulan tüm `offline_conversion_queue` kayıtları: status, value_cents, created_at |
| 2 | **Success confirmation** | COMPLETED kayıtlar: `last_error`, `provider_error_code` (partial failure mesajları) |
| 3 | **QUEUED/RETRY/FAILED** | Worker neden temizlemedi? attempt_count, last_error |
| 4 | **Value sync audit** | value_cents vs call.lead_score, sale_amount (syncQueueValuesFromCalls öncesi/sonrası) |
| 5 | **GCLID vs attribution** | gclid / wbraid / gbraid dolu mu; session click_id; Non-Organic ingest |
| 6 | **Özet** | Toplam mühür, kuyrukta kaç, Google'a giden kaç |

### Tarih aralığı

Varsayılan: bugün (`CURRENT_DATE AT TIME ZONE 'Europe/Istanbul'`). Farklı aralık için:

```sql
-- Son 12 saat:
AND oq.created_at >= now() - interval '12 hours'

-- Son 24 saat:
AND oq.created_at >= now() - interval '24 hours'
```

---

## 2. OCI_VALUE_SYNC Logları

`syncQueueValuesFromCalls` her worker/cron çalıştığında çağrılır. `value_cents` güncellenirse şu log yazılır:

```text
OCI_VALUE_SYNC { site_id, updated_count, prefix }
```

**Nerede bulunur:**

- **Vercel Logs:** Vercel Dashboard → Project → Logs. Filter: `OCI_VALUE_SYNC` veya `b1264552-c859-40cb-a3fb-0ba057afd070`
- **Sentry:** OpsMantik Sentry projesi → Search: `OCI_VALUE_SYNC` veya `site_id:b1264552`

Eslamed için bugün `OCI_VALUE_SYNC` kaydı yoksa: ya worker/cron çalışmadı ya da hiçbir satırda `value_cents` değişmedi.

---

## 3. Google Ads Partial Failure

Google Ads API bazen **200 + partial_failure_error** döner. Yani bazı conversion'lar kabul edilir, bazıları reddedilir. Reddedilenler:

- `Conversion already exists` → Zaten gönderilmiş; Google duplicate eler.
- `Click too recent` → Tıklama ile conversion arasında minimum süre (örn. 1 saat).
- `INVALID_GCLID` / `UNPARSEABLE_GCLID` → GCLID formatı hatalı.
- `RESOURCE_NOT_FOUND` → Conversion action bulunamadı.

Bu durumda `offline_conversion_queue` satırları `FAILED` veya `RETRY` olur; `last_error` ve `provider_error_code` bu mesajları içerir.

---

## 4. Checklist

1. SQL çalıştır → `oci_eslamed_forensic_today.sql`
2. Sorgu 1: 6–7 conversion ID listesi, status'leri
3. Sorgu 2: COMPLETED'ların `last_error` / `provider_error_code` değerleri
4. Sorgu 3: QUEUED/RETRY/FAILED nedenleri
5. Vercel/Sentry'de `OCI_VALUE_SYNC` loglarına bak
6. Sorgu 5: gclid vs wbraid/gbraid; click_id eksik mi?

---

## Deliverable

- 6–7 Eslamed conversion ID listesi
- Her birinin delivery durumu (QUEUED / PROCESSING / COMPLETED / RETRY / FAILED)
- COMPLETED'larda `provider_request_id` (Google'da eşleştirme için)
- Partial failure mesajları: `last_error`, `provider_error_code`
