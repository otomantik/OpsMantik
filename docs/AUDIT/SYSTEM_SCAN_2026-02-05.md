# OpsMantik — Sistem Tarama Raporu (05 Şubat 2026)

**Kapsam:** Güvenlik, mimari, API auth, CORS, rate limit, PII, Edge Functions, test/CI.  
**Bağlam:** Kalitelibakici.com CORS sorunu giderildi; genel sistem taraması yapıldı.

---

## 1. Genel Puan: **82/100** (Production-ready, birkaç iyileştirme önerisi)

| Kategori              | Puan  | Not |
|-----------------------|-------|-----|
| API Auth & Service-Role | 90  | Kritik route’lar auth sonrası admin kullanıyor |
| CORS                  | 95    | Fail-closed, wildcard prod’da throw |
| Edge Functions        | 90    | hunter-ai + maintain-db guard’lı |
| PII / Sentry          | 95    | sendDefaultPii: false, scrubEventPii |
| Rate limiting         | 85    | Per-site, fail-closed/degraded kullanımı var |
| RLS / DB              | 88    | service_role + authenticated ayrımı net |
| Dokümantasyon / Test  | 72    | Hardening doc’lar iyi; birim test sayısı orta |
| Operasyonel risk      | 75    | Cron/watchtower CRON_SECRET yoksa açık |

---

## 2. Güçlü Yönler

- **CORS:** `lib/cors.ts` production’da boş/wildcard için throw; `parseAllowedOrigins()` build-time skip ile doğru.
- **Call-event V1/V2:** Site ID normalizasyonu, idempotency (`event_id`), replay cache, per-site rate limit, CORS (imzalı modda relax) tutarlı.
- **Auth before admin:**  
  - `seal`, `intents/status`, `oci/export`, `customers/invite`, `sites/create`, `sites/[id]/status`, `sync/dlq/replay`, `stats/realtime`, `create-test-site`, `debug/realtime-signal` → önce `createClient()` + `getUser()` (veya Bearer), sonra admin/RLS.  
  - `sync/dlq/list`, `sync/dlq/audit`, `stats/reconcile` → `isAdmin()` sonrası admin.  
  - `oci/ack` → `x-api-key === OCI_API_KEY`.  
  - `oci/export-batch` → `x-api-key` + `timingSafeCompare`.  
  - `watchtower/partition-drift` → `WATCHTOWER_SECRET` + `timingSafeCompare`.  
  - Sync worker → QStash signature verification (`verifySignatureAppRouter`).
- **Edge Functions:**  
  - **hunter-ai:** Shared secret veya JWT; wildcard CORS yok; service-role sadece auth sonrası.  
  - **maintain-db:** Bearer + timing-safe secret; service-role sadece auth sonrası.
- **Sentry:** `sendDefaultPii: false`; `beforeSend` → `scrubEventPii` (IP, fingerprint, phone, Cookie, Authorization).
- **Middleware:** Request ID, Supabase session refresh, `/dashboard` ve `/admin` login zorunlu.

---

## 3. Tespit Edilen Riskler ve Öneriler

### 3.1 Orta — Cron Watchtower fail-open

- **Ne:** `app/api/cron/watchtower/route.ts` içinde `CRON_SECRET` yoksa 401 dönmüyor; endpoint herkese açık.
- **Öneri:** Production’da “secret yoksa 401” yap (fail-closed). Örn:  
  `if (process.env.NODE_ENV === 'production' && !expectedSecret) return 401;`  
  veya her zaman: `if (!expectedSecret || authHeader !== ...) return 401;`

### 3.2 Düşük — Cron test-notification

- **Ne:** `app/api/cron/test-notification/route.ts` CRON_SECRET ile korunuyor; CRON_SECRET boşsa davranış net değil.
- **Öneri:** Aynı fail-closed mantığı (prod’da secret zorunlu veya secret yoksa 401).

### 3.3 Düşük — OCI ACK timing-safe değil

- **Ne:** `app/api/oci/ack/route.ts` `apiKey !== envKey` ile string karşılaştırıyor (timing attack teorik risk).
- **Öneri:** `timingSafeCompare(apiKey, envKey)` kullan (export-batch’teki gibi).

### 3.4 Bilgi — Yeni siteler için CORS

- **Ne:** Yeni müşteri domain’i eklendiğinde `ALLOWED_ORIGINS` (Vercel/env) güncellenmeli; aksi halde sync/call-event CORS’tan düşer.
- **Öneri:** Runbook’ta “Yeni site CORS” adımı net olsun; gerekirse dashboard’dan “allowed origins” önizlemesi (secret’sız).

### 3.5 Bilgi — Health endpoint

- **Ne:** `/api/health` herkese açık; `db_ok`, `signing_disabled`, `git_sha` dönüyor. Hassas bilgi yok; bilinçli tasarım.
- **Öneri:** Değişiklik yapma; sadece ileride eklenen alanlarda PII/secret sızıntısı olmasın.

---

## 4. Özet Tablo — API Route’lar ve Auth

| Route / Endpoint              | Auth / Guard                         | Admin kullanımı      |
|------------------------------|--------------------------------------|----------------------|
| POST /api/sync                | CORS (ALLOWED_ORIGINS)               | Hayır (QStash’e gönderir) |
| POST /api/call-event          | CORS + (imza veya signing_disabled) + site resolve | Evet (anon + admin)   |
| POST /api/call-event/v2       | CORS + proxy attestation + site resolve | Evet                 |
| POST /api/sync/worker        | QStash signature                     | Evet                 |
| GET  /api/sync/dlq/list      | isAdmin()                            | Evet                 |
| GET  /api/sync/dlq/audit     | (kontrol edildi: admin gerekir)      | Evet                 |
| POST /api/sync/dlq/replay    | getUser()                            | Evet                 |
| POST /api/calls/[id]/seal    | getUser() + validateSiteAccess       | Evet (lookup); update RLS |
| POST /api/intents/[id]/status| getUser()                            | Evet                 |
| GET  /api/oci/export         | getUser()                            | Evet                 |
| GET  /api/oci/export-batch   | x-api-key + timingSafeCompare        | Evet                 |
| POST /api/oci/ack            | x-api-key (string compare)           | Evet                 |
| GET  /api/stats/reconcile    | isAdmin()                            | Evet                 |
| POST /api/watchtower/partition-drift | WATCHTOWER_SECRET + timingSafeCompare | Evet         |
| GET  /api/cron/watchtower    | CRON_SECRET (yoksa açık)             | Hayır                |
| POST /api/jobs/auto-approve  | getUser() + RLS site                 | Evet                 |
| Diğer dashboard/ops API’leri | getUser() veya isAdmin()              | Tutarlı              |

---

## 5. Sonuç

- Sistem production kullanımı için uygun; kritik uçlar auth/guard sonrası service-role kullanıyor, CORS ve PII ayarları sağlam.
- Kalitelibakici CORS’u, `ALLOWED_ORIGINS`’e `https://www.kalitelibakici.com` (ve gerekiyorsa `https://kalitelibakici.com`) eklenerek çözülmüş; tarama bu düzeltmeyi kırıcı bir şey tespit etmedi.
- Öncelikli iyileştirme: Cron watchtower (ve istenirse test-notification) için fail-closed; opsiyonel: OCI ACK için timing-safe karşılaştırma.

Bu rapor `docs/AUDIT/SYSTEM_SCAN_2026-02-05.md` olarak kaydedildi.
