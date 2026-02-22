# Motor & DB Compliance Sprint — 3 Zorunlu Düzeltme (Prod-Safe)

Bu doküman, ana sprint planına eklenmesi gereken **3 zorunlu düzeltmeyi** içerir. Mutabakat sağlandı; sprint başlamadan önce plan bu düzeltmelerle güncellenmelidir.

---

## 1) Sync Consent Yoksa: 204 (400 Yok)

**Kural:** `analytics` scope yoksa event işlenmez. Yanıt **400 değil, 204**.

**Gerekçe:**
- 400 → Tracker retry/backoff kaosu, log gürültüsü, rate-limit baskısı
- 204 → "Kabul edildi ama işlenmedi" semantiği; sessiz ve stabil

**Net uygulama:**
- `analytics` scope yoksa: **204**, header: `x-opsmantik-consent-missing: analytics`
- Idempotency row **yazılmaz**
- Queue publish **olmasın**
- Revenue Kernel invaryantı: "işlenmeyen şey billing'e girmez"

---

## 2) POST /api/gdpr/consent: Abuse Koruması

**Sorun:** Bu endpoint en çok abuse yiyecek yer; rakipler "consent spam" ile session tablolarını şişirebilir.

**Zorunlu önlemler:**
- **Auth:** Tracker çağrısı **signed** olmalı (site secret ile HMAC) — mevcut call-event imza modeli gibi
- **Alternatif:** Sadece server-to-server (relay/proxy) üzerinden gelsin
- **Rate limit:** Identifier başına **10/saat** + IP başına **60/saat**

---

## 3) JSONB Redaksiyon v1: Full Replace (Recursive Walk Yok)

**Sorun:** Recursive redaction PL/pgSQL'de riskli: yavaş, karmaşık, eksik key kaçırma, nested array/object edge case.

**v1 zorunlu yaklaşım:**
- `sync_dlq.payload` ve `ingest_fallback_buffer.payload` → **tamamen** replace:
  ```json
  {"redacted": true, "redacted_at": "<iso>", "reason": "gdpr_erase"}
  ```
- Opsiyonel: `payload_hash` gibi non-PII checksum (debugging)
- v2'de istersen recursive selective redact eklenebilir

---

## Consent Granülaritesi: Net Kurallar

| Scope     | analytics yok                 | marketing yok                    |
|----------|-------------------------------|----------------------------------|
| Session/event yazımı | Hayır (fail-closed, 204)      | Evet                             |
| OCI enqueue          | N/A (event yazılmadı)         | Hayır                            |

---

## Audit Log Metadata: PII Yasak

- `audit_log.metadata` içine **asla ham PII koyma**
- Sadece: "hangi alanlar redakte edildi", "kaç kayıt etkilendi" vb. agregat bilgi

---

## Calls Tablosu: Korunacak Non-PII Alanlar

Anonimleştirilecek: `phone_number`, `matched_fingerprint`, `click_id`, `intent_page_url`  
**Korunacak:** Call outcome, billing ile ilgili non-PII alanlar (`sale_amount`, `value_cents`, `status`, `lead_score`, vb.)

---

## Go/No-Go Kabul Kriterleri (Sprint Sonu)

1. **POST /api/gdpr/erase** çalıştıktan sonra:
   - sessions/events/calls içindeki PII alanları NULL veya redacted
   - Billing çekirdeği bozulmuyor (idempotency, site_usage_monthly tutarlı)
   - sync_dlq ve ingest_fallback_buffer: payload v1 full-replace marker oluyor

2. **Consent:**
   - analytics yok → 204 + header, DB write yok, queue yok
   - marketing yok → session/event write var, OCI enqueue yok

3. **Audit:**
   - Low-volume tablolar UPDATE/DELETE → audit_log yazıyor
   - ERASE/EXPORT → audit_log yazıyor (metadata'da PII yok)
