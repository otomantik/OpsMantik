# OpsMantik — Proje Olgunluk ve Aşama Raporu

**Tarih:** 6 Şubat 2026  
**Kapsam:** Tüm proje dosyaları, mimari, güvenlik, test, dokümantasyon, CI/CD, operasyon  
**Amaç:** Projenin hangi aşamada olduğunu (Alpha / Beta / Production / Enterprise) netleştirmek ve puanlamak.

---

## 1. Özet Karar ve Puan

| Metrik | Değer |
|--------|--------|
| **Genel puan** | **78/100** |
| **Aşama** | **Production (erken)** — Beta’yı geçmiş, tam production/enterprise değil |
| **Versiyon** | `0.1.0` (package.json) — semantik olarak erken production |

**Kısa özet:** Sistem canlıda çalışıyor, çok kiracılı (multi-tenant), güvenlik ve CORS/rate limit katmanları yerinde. RLS, auth, Sentry, hardening dokümanları ve V2 call-event mimarisi mevcut. Eksikler: resmi SLA/SLO, enterprise SSO/RBAC, kapsamlı birim testleri, cron fail-closed ve bazı operasyonel runbook’lar. Bu tabloya göre **Production (erken)** aşamasında; **Enterprise** için ek yatırım gerekir.

---

## 2. Kategori Bazlı Puanlama

### 2.1 Mimari ve Kod Tabanı — 82/100

| Alt başlık | Puan | Açıklama |
|------------|------|----------|
| Proje yapısı | 90 | Next.js App Router, `app/`, `lib/`, `components/` net ayrılmış; API route’lar tutarlı. |
| Veritabanı | 88 | 123 migration, partition (sessions/events), RLS, private schema, RPC’ler (apply_call_action_v1, undo_last_action_v1, get_activity_feed_v1, resolve_site_identifier_v1, vb.). |
| Servis katmanı | 80 | RateLimitService, ReplayCacheService, SessionService, IntentService, Watchtower; logger abstraction var. |
| Tip güvenliği | 85 | TypeScript, Zod (sync/call-event), lib/types kullanımı. |
| Bağımlılıklar | 85 | Ağır yeni bağımlılık yok; Next 16, React 19, Supabase, Sentry, Upstash, Zod. |

**Eksikler:** Bazı büyük component dosyaları refactor edilmiş (QualificationQueue, useQueueController) ama kod tabanında hâlâ büyük dosyalar olabilir; tam modülerlik enterprise seviyesinde değil.

---

### 2.2 Güvenlik — 85/100

| Alt başlık | Puan | Açıklama |
|------------|------|----------|
| Auth & yetkilendirme | 88 | Dashboard/admin için Supabase auth; `validateSiteAccess`, `isAdmin()`; service-role sadece auth sonrası. |
| CORS | 95 | Fail-closed production; wildcard prod’da throw; `parseAllowedOrigins`, `isOriginAllowed` (lib/cors.ts). |
| API koruma | 85 | Call-event V1/V2: imza, replay cache, per-site rate limit; sync: rate limit, QStash worker imzası. |
| PII / Sentry | 95 | `sendDefaultPii: false`, `scrubEventPii` (Cookie, Authorization, IP). |
| Edge Functions | 90 | hunter-ai: shared secret veya JWT, wildcard CORS yok; maintain-db: CRON_SECRET + timing-safe. |
| Gizlilik | 90 | Site secret’lar private schema’da; V2 proxy ile tarayıcıda secret yok. |

**Eksikler:** Cron watchtower’da CRON_SECRET yoksa fail-open (docs/AUDIT’te belirtilmiş); OCI ACK’ta timing-safe compare yok; resmi güvenlik sertifikasyonu yok.

---

### 2.3 Test ve Kalite — 70/100

| Alt başlık | Puan | Açıklama |
|------------|------|----------|
| E2E | 80 | Playwright, `e2e.yml` (PR/push), build + health check + chromium; dashboard-watchtower senaryoları. |
| Smoke | 90 | 25+ smoke script (sync, hunter-card, watchtower, tank-tracker, api.prod, vb.); nightly + PR. |
| Birim test | 55 | Sadece birkaç: rateLimitService, replayCacheService, siteIdentifier, verifySignedRequest. |
| Load test | 75 | k6 smoke-load.js (50 VU, /api/sync); dokümante; k6 PATH’te gerekebilir. |
| CI/CD | 82 | E2E + smoke workflow’ları; DB RPC/trigger doğrulama; artifact upload. |

**Eksikler:** Birim test kapsamı düşük; kritik RPC ve servisler için unit test az; coverage raporu yok.

---

### 2.4 Dokümantasyon ve Operasyon — 75/100

| Alt başlık | Puan | Açıklama |
|------------|------|----------|
| Mimari | 90 | ARCHITECTURE.md, ENDPOINTS_OVERVIEW.md, API contract, REALTIME_SOURCE_OF_TRUTH. |
| Güvenlik / rollout | 88 | HARDENING_V2_CALL_EVENT.md, ROLL_OUT_PLAN.md, CALL_EVENT_PROXY_WORDPRESS, CORS_MANAGEMENT. |
| Kurulum | 85 | README, .env.local.example, SETUP (Auth, CORS, Deploy, WP), INSTALL_K6.md. |
| Audit / rapor | 85 | SYSTEM_SCAN_2026-02-05, SECURITY_AUDIT, TECH_DEBT_SCAN, MIGRATIONS_INDEX. |
| Runbook / SLA | 50 | OPS (SMOKE, NO_LEADS_TODAY_DIAGNOSTIC, SCALING_AND_COSTS); resmi SLA/SLO dokümanı yok; on-call runbook sınırlı. |

**Eksikler:** Formal SLA/SLO, RTO/RPO, enterprise “support tiers” yok; bazı cron/alert runbook’ları eksik.

---

### 2.5 Özellik Seti ve Ürün Olgunluğu — 80/100

| Alt başlık | Puan | Açıklama |
|------------|------|----------|
| Çekirdek ürün | 88 | Sync, call-event, intent/call eşleme, lead skorlama, queue (seal/junk/cancel), activity log, undo. |
| Dashboard | 85 | Site bazlı dashboard, KPIs, breakdown, realtime, qualification queue, activity feed. |
| OCI / entegrasyon | 85 | OCI export, export-batch (Google Ads Script), ack; API key + timing-safe (export-batch). |
| Çok kiracılık | 85 | Sites, RLS, site membership, admin sites; invite/audit. |
| Gelişmiş özellikler | 70 | Hunter AI, auto-approve, watchtower, partition drift; enterprise “God Mode” roadmap (ENTERPRISE_MODERNIZATION) henüz tam değil. |

**Eksikler:** SSO/SAML, kurumsal RBAC, resmi API versioning, SLA dashboard yok.

---

### 2.6 Dağıtım ve Altyapı — 78/100

| Alt başlık | Puan | Açıklama |
|------------|------|----------|
| Hosting | 90 | Vercel (Next.js), vercel.json (cron); Supabase (DB, Realtime, Edge Functions). |
| Config | 85 | next.config (Sentry, removeConsole prod), env example; CORS fail-closed. |
| İzleme | 82 | Sentry (server/edge), health endpoint (db_ok, signing_disabled, git_sha). |
| Ölçeklenebilirlik | 75 | Sync worker QStash ile; partition; rate limit; yüksek trafik için >100 intent/dk hedefi dokümante ama tam stress test sınırlı. |

**Eksikler:** Resmi staging/prod promotion pipeline dokümanı; multi-region veya DR planı yok.

---

## 3. Aşama Tanımları ve Eşleme

| Aşama | Kriterler | OpsMantik durumu |
|-------|-----------|-------------------|
| **Alpha** | Özellikler geliştirilir; sadece internal kullanım; sık kırılma. | ❌ Geçildi — canlı müşteri trafiği var. |
| **Beta** | Özellikler stabil; erken dış kullanıcı; bilinen limitasyonlar. | ✅ Kısmen — birçok Beta kriteri karşılanıyor ama Production kriterleri de kısmen karşılanıyor. |
| **Production** | Canlı kullanım; güvenlik ve izleme yerinde; dokümante rollout; geri alım planı. | ✅ **Eşleşme** — canlı kullanım, CORS/auth/rate limit, hardening, rollback dokümanı, health/Sentry. |
| **Enterprise** | SLA/SLO, SSO/RBAC, resmi destek seviyeleri, compliance, kapsamlı test ve runbook. | ❌ Henüz değil — SLA, SSO, formal RBAC, tam runbook seti yok. |

**Sonuç:** Proje **Production (erken)** aşamasında. Beta’nın üzerinde; tam “Enterprise” için ek yatırım gerekir.

---

## 4. Dosya ve Sayısal Özet

| Kategori | Sayı / Not |
|----------|------------|
| Toplam migration | 123 (supabase/migrations/*.sql) |
| API route (app/api) | 25+ endpoint (sync, call-event, call-event/v2, seal, intents, oci, sites, cron, watchtower, health, vb.) |
| Ana lib servisleri | 11 (RateLimitService, ReplayCacheService, SessionService, IntentService, vb.) |
| Hooks | 16 (lib/hooks) |
| Dashboard component | 48 (components/dashboard) |
| Smoke script | 25+ (scripts/smoke) |
| E2E spec | Playwright (dashboard-watchtower, vb.) |
| Unit test dosyası | 4 (rateLimitService, replayCacheService, siteIdentifier, verifySignedRequest) |
| GitHub Actions workflow | 2 (e2e, smoke) |
| Doküman (docs) | ARCHITECTURE, API, AUDIT, OPS, SETUP, HARDENING, ROLL_OUT, missions |

---

## 5. Güçlü Yönler

1. **Güvenlik:** CORS fail-closed, PII scrubbing, auth-before-admin, timing-safe kritik yerlerde, Edge Function guard’ları.
2. **Mimari:** Partition’lı DB, RLS, net API ayrımı, V2 call-event (proxy + idempotency, replay, site resolve).
3. **İzleme:** Sentry, health endpoint, signing_disabled uyarısı, request ID.
4. **Dokümantasyon:** Mimari, API, hardening, rollout, audit raporları mevcut.
5. **Test:** E2E ve smoke zengin; load test (k6) başlatılmış.
6. **Ürün:** Sync, call-event, queue, seal, activity log, undo, OCI entegrasyonu çalışır durumda.

---

## 6. İyileştirme Önerileri (Öncelik Sırasıyla)

1. **Cron fail-closed:** `CRON_SECRET` yoksa production’da 401 dön; test-notification ile aynı mantık.
2. **OCI ACK:** API key karşılaştırmasını `timingSafeCompare` ile yap.
3. **Birim test:** Kritik RPC ve servisler (call-event, sync worker, site resolve) için unit test artır; coverage hedefi koy.
4. **SLA/SLO taslağı:** Uptime hedefi, hata oranı, p95 latency (örn. /api/sync, /api/call-event) dokümante et.
5. **Runbook:** “Yeni site CORS”, “Call-event 500”, “Partition drift” için adım adım runbook.
6. **Enterprise yol haritası:** SSO, RBAC, resmi API versioning, SLA dashboard için docs/missions veya ayrı roadmap.

---

## 7. Sonuç Tablosu

| Soru | Cevap |
|------|--------|
| **Beta mı?** | Hayır — Production (erken) seviyesinde. |
| **Production mı?** | Evet — canlı kullanım, güvenlik ve operasyon yeterli. |
| **Enterprise mi?** | Henüz değil — SLA, SSO, formal RBAC ve tam runbook seti eksik. |
| **Genel puan** | **78/100** |
| **Önerilen etiket** | **Production (Early)** — v1.0’a geçiş için cron fail-closed + birim test artırımı yeterli olur. |

Bu rapor `docs/AUDIT/PROJE_OLGUNLUK_RAPORU_2026-02-06.md` olarak kaydedildi.
