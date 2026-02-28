# Sızıntı Raporu — Leakage & Güvenlik Açığı Denetimi

**Tarih:** 2026-02-25  
**Kapsam:** Veri sızıntısı, log sızıntısı, hata mesajı sızıntısı, cross-tenant erişim riskleri

---

## Özet

| Kategori | KIRMIZI | TURUNCU | SARI | OK |
|----------|---------|---------|------|-----|
| Log/console sızıntısı | 1 | 3 | 1 | — |
| Hata mesajı sızıntısı | 0 | 8 | 2 | — |
| Cross-tenant / IDOR | 0 | 1 | 0 | 15+ |
| PII / hassas veri | 0 | 2 | 1 | — |

---

## 1. Log ve Console Sızıntıları

### KIRMIZI — Kritik

| # | Dosya | Satır | Bulgu |
|---|-------|-------|-------|
| 1 | `lib/security/validate-site-access.ts` | 106–111 | `console.warn('[SECURITY] Unauthorized site access attempt', { userId, siteId, ip, timestamp })` — userId ve siteId production loglarında görünür. Harici log agregatörlerinde (Sentry, Datadog, vb.) bu veriler saklanabilir; yetkisiz erişim denemelerinde kullanıcı/site tanımlayıcıları sızabilir. |

### TURUNCU — Orta

| # | Dosya | Satır | Bulgu |
|---|-------|-------|-------|
| 1 | `lib/security/validate-site-access.ts` | 119 | `console.error('[SECURITY] Error validating site access:', error)` — Tam error objesi loglanıyor; stack trace veya DB mesajları sızabilir. |
| 2 | `lib/ingest/process-call-event.ts` | 178 | `console.error('[HARDENING] Failed to trigger async scoring:', qError)` — qError (QueueError vb.) URL, payload veya iç yapı bilgisi içerebilir. |
| 3 | `app/api/oci/ack/route.ts` | 71 | `console.error('[OCI ACK] SQL error:', error.message, { code, siteId, idsReceived })` — siteId ve idsReceived production loglarında; hassas iş verisi sızıntısı riski. |

### SARI — Düşük

| # | Dosya | Bulgu |
|---|-------|-------|
| 1 | `lib/supabase/tenant-client.ts` | `console.error('[TENANT_CLIENT_RPC_GUARD] Violation...')` — Sadece guard ihlali; içerik hassas değil ama log hacmi artabilir. |

---

## 2. API Yanıtlarında Hata Mesajı Sızıntısı

### TURUNCU — Orta

Birçok route `error.message` veya `details: error.message` döndürüyor. Postgres/DB hata mesajları bazen tablo/kolon adı veya SQL ipucu içerir; bilgi sızıntısına yol açabilir.

| # | Dosya | Satır | Örnek |
|---|-------|-------|-------|
| 1 | `app/api/oci/export-batch/route.ts` | 80, 114 | `{ error: 'Failed to load calls', details: callsError.message }` |
| 2 | `app/api/oci/export/route.ts` | 86, 103 | `details: callsError.message`, `details: sessError.message` |
| 3 | `app/api/oci/google-ads-export/route.ts` | 126, 190 | `details: fetchError.message`, `details: updateError.message` |
| 4 | `app/api/oci/ack/route.ts` | 73 | `details: error.message` |
| 5 | `app/api/gdpr/export/route.ts` | 84 | `details: error.message` |
| 6 | `app/api/gdpr/erase/route.ts` | 121 | `details: rpcErr.message` |
| 7 | `app/api/create-test-site/route.ts` | 65 | `details: error.message, code: error.code` |
| 8 | `app/api/sites/create/route.ts` | 102, 161 | `details: updateErr.message`, `details: createError.message` |

### SARI — Düşük

| # | Dosya | Not |
|---|-------|-----|
| 1 | `app/api/sales/route.ts` | `{ error: error.message }` — Genel 500, ancak message hâlâ detay içerebilir. |
| 2 | `app/api/reporting/dashboard-stats/route.ts` | 66 — Aynı pattern. |

---

## 3. Cross-Tenant ve IDOR Riskleri

### TURUNCU — Orta

| # | Dosya | Bulgu |
|---|-------|-------|
| 1 | `app/api/oci/export-batch/route.ts` | x-api-key ile auth; siteId query param’dan alınıyor. API key ortaksa, geçerli key ile başka siteId’ler denenebilir. Site lookup var; var olan site için veri dönülür. OCI_API_KEY sızdığında herhangi bir site verisi çekilebilir. |

### OK — Koruma Mevcut

| Route | Koruma |
|-------|--------|
| `/api/reporting/dashboard-stats` | validateSiteAccess(siteId, user.id) |
| `/api/stats/realtime` | validateSiteAccess(site.id, user.id) |
| `/api/dashboard/spend` | validateSiteAccess(siteId, user.id) |
| `/api/sales/*` | validateSiteAccess(site_id / sale.site_id, user.id) |
| `/api/calls/[id]/seal` | Admin lookup, validateSiteAccess(siteId, user.id) |
| `/api/calls/[id]/stage` | validateSiteAccess(siteId, user.id) |
| `/api/conversations/*` | validateSiteAccess(siteId / conversation.site_id, user.id) |
| `/api/providers/credentials/*` | validateSiteAccess(siteId, user.id) |
| `/api/gdpr/export`, `/api/gdpr/erase` | validateSiteAccess(siteUuid, user.id) |
| `/api/customers/invite` | validateSiteAccess(site_id, currentUser.id) |
| `/api/intents/[id]/status` | validateSiteAccess(siteId, user.id) |
| `/api/debug/realtime-signal` | validateSiteAccess(siteId, user.id) |

---

## 4. PII ve Hassas Veri Riskleri

### TURUNCU — Orta

| # | Dosya | Bulgu |
|---|-------|-------|
| 1 | `lib/security/validate-site-access.ts` | Unauthorized denemede userId, siteId loglanıyor; bu kimlikler PII sayılabilir. |
| 2 | `app/api/billing/dispute-export/route.ts` | 139 — CSV/stream içinde `ERROR: ${error.message}`; error.message hassas bilgi taşıyabilir. |

### SARI — Düşük

| # | Dosya | Bulgu |
|---|-------|-------|
| 1 | `scripts/smoke/casino-ui-proof.mjs` | 69–70 — `console.log('Proof user id:', session.user.id)` — Sadece smoke script; production’da çalışmaz. |

---

## 5. Önerilen Düzeltmeler

### Kritik (KIRMIZI)

1. **validate-site-access.ts:106–111**  
   - userId ve siteId yerine hash veya kısa prefix kullan: örn. `userIdHash: sha256(userId).slice(0,8)`, `siteIdPrefix: siteId.slice(0,8)`  
   - Veya `logWarn` ile structured logger kullan; hassas alanları redact et.

### Orta (TURUNCU)

1. **Hata mesajlarında detay kaldır**  
   - API yanıtlarında `details: error.message` yerine genel kod kullan: `{ error: 'internal_error', code: 'E500' }`  
   - Gerçek mesaj sadece internal loglara yazılsın.

2. **console.error yerine logError**  
   - `lib/ingest/process-call-event.ts:178`, `app/api/oci/ack/route.ts:71`  
   - `logError` kullan; hassas alanları (payload, URL, siteId) redact et.

3. **OCI export-batch**  
   - Mümkünse API key’i site bazlı veya token’a site scope bağla.  
   - Alternatif: siteId’yi token/JWT’den türet; query param ile kullanıcı girişini kabul etme.

### Düşük (SARI)

1. **Tenant-client guard logları** — Structured logger ile; log seviyesini `debug` yap.

---

## 6. Özet Tablo (Dosya:Satır)

| Öncelik | Dosya | Satır | Aksiyon |
|---------|-------|-------|---------|
| KIRMIZI | `lib/security/validate-site-access.ts` | 106–111 | userId/siteId redact |
| TURUNCU | `lib/security/validate-site-access.ts` | 119 | logError + redact |
| TURUNCU | `lib/ingest/process-call-event.ts` | 178 | logError, qError redact |
| TURUNCU | `app/api/oci/ack/route.ts` | 71, 73 | logError; response’ta details kaldır |
| TURUNCU | `app/api/oci/export-batch/route.ts` | 80, 114 | details kaldır; site-scoped API key değerlendir |
| TURUNCU | `app/api/oci/export/route.ts` | 86, 103 | details kaldır |
| TURUNCU | `app/api/gdpr/export/route.ts` | 84 | details kaldır |
| TURUNCU | `app/api/gdpr/erase/route.ts` | 121 | details kaldır |
| TURUNCU | `app/api/billing/dispute-export/route.ts` | 139 | error.message stream’e yazma; genel mesaj kullan |

---

## 7. Uygulanan Düzeltmeler (STRICT SECURITY PATCH)

| Düzeltme | Dosya | Durum |
|----------|-------|-------|
| Log redaction (userId/siteId hash) | `lib/security/validate-site-access.ts`, `lib/security/redact-for-log.ts` | ✅ hashForLog() ile SHA-256 prefix; logWarn/logError |
| Generic API errors | OCI, GDPR, Billing, Sites, Sales, Dashboard, Debug | ✅ `details` kaldırıldı; `{ error: 'Something went wrong', code: 'SERVER_ERROR' }` |
| OCI site-scoped API key | `app/api/oci/export-batch/route.ts` | ✅ OCI_API_KEYS="siteId:key,siteId:key" formatı; SITE_KEY_MISMATCH → 403 |

**OCI_API_KEYS formatı:** `OCI_API_KEYS="uuid1:key1,uuid2:key2"` — Her site için ayrı key. OCI_API_KEYS yoksa OCI_API_KEY (tek key) ile geriye dönük uyum.

---

**Sonraki Adım:** Kalan route'larda (customers/invite, webhooks, sync/dlq, vb.) `details` kontrol edilmeli; varsa generic hata ile değiştirilmeli.
