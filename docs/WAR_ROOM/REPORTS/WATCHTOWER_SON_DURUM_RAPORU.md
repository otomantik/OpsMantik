# Watchtower — Son Durum Raporu

**Tarih:** 2026-01-30  
**Kapsam:** GO W1 (health + request-id + log), GO W2 (Sentry/GlitchTip + PII scrub), GO W3 (Playwright E2E-lite) ve ilgili düzeltmeler.

---

## 1. Özet

| Bileşen | Durum | Açıklama |
|---------|--------|-----------|
| **GO W1** | ✅ Tamamlandı | Health endpoint, x-request-id, yapılandırılmış log (lib/log), API route’larda request_id + logError |
| **GO W2** | ✅ Tamamlandı | @sentry/nextjs, beforeSend PII scrub, OPSMANTIK_RELEASE, test-throw endpoint, sync/seal/call-event/intents catch’te captureException |
| **GO W3** | ✅ Tamamlandı | Playwright config, 3 E2E akışı (dashboard/login console, settings overflow, seal modal), CI workflow, auth.json (opsiyonel) |
| **Hydration** | ✅ Düzeltildi | data-pw-cursor (Playwright) uyumsuzluğu için html/body’de suppressHydrationWarning |
| **beforeSend tipi** | ✅ Düzeltildi | instrumentation-client’ta ErrorEvent ↔ Event uyumu için cast |
| **E2E auth** | ✅ Opsiyonel | auth.json + storageState; .gitignore’da auth.json; şifre koda yazılmıyor |

---

## 2. GO W1 — Health & Request ID & Log

- **Dosyalar:** `middleware.ts` (x-request-id), `app/api/health/route.ts`, `lib/log.ts`, API route’larda logInfo/logError.
- **Smoke:** `npm run smoke:watchtower` → /api/health 200, x-request-id header.
- **Evidence:** `docs/WAR_ROOM/EVIDENCE/WATCHTOWER_GO1/`.

---

## 3. GO W2 — Error Tracking (Sentry / GlitchTip)

- **Dosyalar:** `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts`, `lib/sentry-pii.ts`, `app/global-error.tsx`, `app/api/watchtower/test-throw/route.ts`, next.config (withSentryConfig), sync/seal/call-event/intents catch’te Sentry.captureException.
- **Env:** NEXT_PUBLIC_SENTRY_DSN, OPSMANTIK_RELEASE (opsiyonel). WATCHTOWER_TEST_THROW=1 → test-throw 500.
- **PII:** beforeSend’de IP/fingerprint/phone scrub; sendDefaultPii: false.
- **Smoke:** WATCHTOWER_TEST_THROW=1 ile app + `WATCHTOWER_TEST_THROW=1 node scripts/smoke/watchtower-proof.mjs` → 500 + x-request-id.
- **Doc:** `docs/WAR_ROOM/REPORTS/WATCHTOWER_SETUP.md`.
- **Evidence:** `docs/WAR_ROOM/EVIDENCE/WATCHTOWER_GO2/`.

---

## 4. GO W3 — Playwright E2E-lite

- **Dosyalar:** `playwright.config.ts` (baseURL, siteId, storageState opsiyonel, screenshot/video on failure), `tests/dashboard-watchtower.spec.ts`, `.github/workflows/e2e.yml`, package.json (e2e, e2e:ui).
- **Akışlar:**
  1. Dashboard veya login yüklenir, console error yok.
  2. Mobil viewport’ta overflow menü → Settings → dialog açılır (login’de skip).
  3. Seal deal → modal → chip → confirm → “Deal sealed.” (intent yoksa veya login’de skip).
- **Auth:** auth.json varsa storageState ile kullanılır; yoksa test 2–3 skip. Şifre/e-posta koda yazılmıyor; auth.json .gitignore’da.
- **CI:** PR’da build → start → health bekle → playwright test (chromium); hata olursa test-results/playwright-report artifact.
- **Evidence:** `docs/WAR_ROOM/EVIDENCE/WATCHTOWER_GO3/AUTOPROOF_PACK.md`.

---

## 5. Komutlar

| Amaç | Komut |
|------|--------|
| Health smoke | `npm run smoke:watchtower` (app çalışırken) |
| Test-throw smoke | App’i `WATCHTOWER_TEST_THROW=1` ile başlat, sonra `WATCHTOWER_TEST_THROW=1 node scripts/smoke/watchtower-proof.mjs` |
| E2E | App çalışırken `npx playwright test` veya `npm run e2e` |
| Oturum kaydet (E2E auth) | `npx playwright codegen http://localhost:3000 --save-storage=auth.json` (giriş yap, kapat) |
| Build | `npm run build` |

---

## 6. Bağımlılıklar

- **@sentry/nextjs** (dependencies); Next 16 ile peer uyarısı için .npmrc’ta legacy-peer-deps=true.
- **@playwright/test**, **playwright** (devDependencies).

---

## 7. Referanslar

- WATCHTOWER_SETUP.md — Env ve doğrulama
- EVIDENCE/WATCHTOWER_GO1, GO2, GO3 — AUTOPROOF PACK / smoke log’lar
