# GO W3 — Playwright E2E-lite (AUTOPROOF PACK)

**Scope:** E2E-lite for 3 fragile flows; CI on PR; screenshots/videos on failure.  
**Smoke:** `npm run build` then `npx playwright test` (headless). App must be running for E2E (or CI starts it).

---

## 1) Flows covered

| Flow | Test | Notes |
|------|------|--------|
| 1) Dashboard loads without console errors | `1) dashboard/site/[siteId] or login loads without console errors` | Navigate to `/dashboard/site/{siteId}`; assert no console errors; accepts redirect to `/login` (auth required). |
| 2) Settings from overflow (mobile viewport) | `2) settings opens from overflow menu (mobile viewport)` | Viewport 390×844; open overflow menu (⋯), click Settings; assert settings dialog visible. Skips when on login. |
| 3) Seal modal → seal API → UI updates | `3) seal modal -> seal API -> UI updates` | Click first "Seal deal" button; open modal; select chip; confirm; assert modal closes and "Deal sealed." visible. Skips when no intent in queue or on login. |

---

## 2) Files touched

| File | Change |
|------|--------|
| `playwright.config.ts` | **NEW** — baseURL/siteId from env; screenshot on failure; video retain-on-failure; projects chromium + mobile |
| `tests/dashboard-watchtower.spec.ts` | **NEW** — 3 tests above |
| `package.json` | **MOD** — devDependency `@playwright/test`; scripts `e2e`, `e2e:ui` |
| `.github/workflows/e2e.yml` | **NEW** — build, start app, wait for health, `npx playwright test --project=chromium`; upload artifacts on failure |
| `.gitignore` | **MOD** — test-results/, playwright-report/, playwright/.cache/ |

---

## 3) Env (base URL + credentials)

| Variable | Where | Description |
|----------|--------|-------------|
| `BASE_URL` / `PLAYWRIGHT_BASE_URL` | Local / CI | Base URL (default `http://localhost:3000`). CI uses `http://localhost:3000` after starting app. |
| `E2E_SITE_ID` / `PLAYWRIGHT_SITE_ID` | Local / CI | Site ID for `/dashboard/site/[siteId]`. Optional; default placeholder UUID. |
| `E2E_BASE_URL` | CI secret | Optional override for deployed URL (e.g. staging). |

Auth: App uses Google OAuth. Tests that need dashboard will skip when redirected to login (no email/password in E2E).

---

## 4) Commands

```bash
# Build
npm run build

# E2E (headless; app must be running)
npx playwright test

# E2E with UI
npm run e2e:ui
```

CI: `npm run build` → `npm run start` (background) → wait for `/api/health` → `npx playwright test --project=chromium`.

---

## 5) Artifacts on failure

- Screenshots: `test-results/` (only-on-failure).
- Video: `test-results/` (retain-on-failure).
- CI: workflow uploads `test-results/` and `playwright-report/` when the job fails (retention 7 days).

---

## 6) PASS/FAIL checklist

| Item | Status |
|------|--------|
| npm run build | ☐ PASS / ☐ FAIL |
| npx playwright test (app running) | ☐ PASS / ☐ FAIL |
| Flow 1: no console errors | ☐ PASS / ☐ FAIL |
| Flow 2: settings from overflow (mobile) | ☐ PASS / ☐ FAIL |
| Flow 3: seal modal → API → UI | ☐ PASS / ☐ FAIL / ☐ SKIP (no intents) |
| CI E2E job on PR | ☐ PASS / ☐ FAIL |
