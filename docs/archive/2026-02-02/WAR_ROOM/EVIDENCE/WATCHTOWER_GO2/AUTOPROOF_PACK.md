# GO W2 — Watchtower Error Tracking (AUTOPROOF PACK)

**Scope:** Sentry/GlitchTip SDK, PII scrubbing, release tagging, API + dashboard error capture, test-throw + smoke.  
**Smoke (W2):** `WATCHTOWER_TEST_THROW=1 node scripts/smoke/watchtower-proof.mjs` (app must run with `WATCHTOWER_TEST_THROW=1`).

---

## 1) Files touched

| File | Change |
|------|--------|
| `package.json` | **ADD** — `@sentry/nextjs` dependency |
| `next.config.ts` | **MOD** — wrap with `withSentryConfig` (org/project from env) |
| `lib/sentry-pii.ts` | **NEW** — PII scrub: IP → [IP], fingerprint → [FINGERPRINT], phone masked; `scrubEventPii(event)` |
| `instrumentation-client.ts` | **NEW** — Client Sentry init; beforeSend = scrubEventPii; release = NEXT_PUBLIC_OPSMANTIK_RELEASE \|\| VERCEL_GIT_COMMIT_SHA |
| `sentry.server.config.ts` | **NEW** — Server Sentry init; beforeSend = scrubEventPii; release = OPSMANTIK_RELEASE |
| `sentry.edge.config.ts` | **NEW** — Edge Sentry init; beforeSend = scrubEventPii |
| `instrumentation.ts` | **NEW** — Register server/edge configs; export onRequestError = Sentry.captureRequestError |
| `app/global-error.tsx` | **NEW** — Capture React render errors; Sentry.captureException(error) |
| `app/api/watchtower/test-throw/route.ts` | **NEW** — GET throws only when WATCHTOWER_TEST_THROW=1; else 200 { ok: true } |
| `app/api/sync/route.ts` | **MOD** — Sentry.captureException in catch |
| `app/api/call-event/route.ts` | **MOD** — Sentry.captureException in catch |
| `app/api/calls/[id]/seal/route.ts` | **MOD** — Sentry.captureException in catch |
| `app/api/intents/[id]/status/route.ts` | **MOD** — Sentry.captureException in catch |
| `scripts/smoke/watchtower-proof.mjs` | **MOD** — When WATCHTOWER_TEST_THROW=1, GET test-throw → assert 500 + x-request-id; write GO2 evidence |

---

## 2) Key diff hunks

- **lib/sentry-pii.ts:** `scrubEventPii(event)` — user.ip_address → [IP]; request headers (x-forwarded-for, x-real-ip, x-fingerprint) scrubbed; message/extra/exception value phone-masked.
- **instrumentation-client / sentry.server / sentry.edge:** `beforeSend: scrubEventPii`, `sendDefaultPii: false`, `release` from OPSMANTIK_RELEASE / NEXT_PUBLIC_*.
- **app/api/watchtower/test-throw:** `if (process.env.WATCHTOWER_TEST_THROW === '1') throw new Error(...)`; else 200.
- **API routes:** `Sentry.captureException(error, { tags: { request_id, route } })` in catch after logError.

---

## 3) Build logs

```bash
npm install
npm run build
```

Paste output below (or "PASS" / "FAIL"):

```
( paste here )
```

---

## 4) Smoke logs (GO W2)

Start app with test-throw enabled, then:

```bash
WATCHTOWER_TEST_THROW=1 node scripts/smoke/watchtower-proof.mjs
```

Paste output below (or "PASS" / "FAIL"):

```
( paste here )
```

---

## 5) Evidence files

| File | Description |
|------|-------------|
| `docs/WAR_ROOM/EVIDENCE/WATCHTOWER_GO2/smoke_log.txt` | Written by watchtower-proof.mjs when WATCHTOWER_TEST_THROW=1 and test-throw passes |
| `docs/WAR_ROOM/EVIDENCE/WATCHTOWER_GO2/AUTOPROOF_PACK.md` | This file |
| `docs/WAR_ROOM/REPORTS/WATCHTOWER_SETUP.md` | Env vars + how to verify |

---

## 6) PASS/FAIL checklist

| Item | Status |
|------|--------|
| @sentry/nextjs installed | ☐ PASS / ☐ FAIL |
| beforeSend scrubs IP / fingerprint / phone | ☐ PASS / ☐ FAIL |
| OPSMANTIK_RELEASE (or NEXT_PUBLIC_*) used for release | ☐ PASS / ☐ FAIL |
| /api/watchtower/test-throw returns 500 when WATCHTOWER_TEST_THROW=1 | ☐ PASS / ☐ FAIL |
| test-throw response has x-request-id | ☐ PASS / ☐ FAIL |
| npm run build | ☐ PASS / ☐ FAIL |
| WATCHTOWER_TEST_THROW=1 smoke (test-throw step) | ☐ PASS / ☐ FAIL |
