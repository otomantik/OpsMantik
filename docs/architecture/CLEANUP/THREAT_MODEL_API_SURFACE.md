# Threat model — API surface classes

Fill one row per `app/api/**/route.ts` over time. Classes:

| Class | Meaning |
|-------|---------|
| `public_anon` | No session; may use site secret / API key |
| `api_key_script` | Google Ads script or OCI key (`x-api-key`) |
| `session_user` | Cookie session (Supabase) |
| `service_role_cron` | `CRON_SECRET` bearer |
| `internal_webhook` | Shared-secret or signed webhook |
| `debug_dev` | Dev/smoke helpers; **must not respond in production** |

## `debug_dev` — production policy

Routes in this class exist for local smoke, Playwright proofs, or operator sandboxes. They **must** use [`lib/env/is-production-deployment.ts`](../../../lib/env/is-production-deployment.ts) (`assertNotProductionDeployment` / `isProductionDeployment`).

When `NODE_ENV`, `VERCEL_ENV`, or `OCI_ENV` is `production`, handlers return **404** with body `{ "error": "Not found" }` (fail-closed; no route metadata).

| Route | Non-prod behavior | Prod |
|-------|-------------------|------|
| `POST /api/debug/realtime-signal` | Session + site access; synthetic realtime row | 404 |
| `POST /api/create-test-site` | Session; provision test site | 404 |
| `GET /api/test-oci` | Mock Google Ads upload probe | 404 |
| `GET /api/watchtower/test-throw` | `WATCHTOWER_TEST_THROW=1` → 500 + Sentry | **404 always** (env cannot enable throw) |

Regression: [`tests/unit/dev-api-production-guard.test.ts`](../../../tests/unit/dev-api-production-guard.test.ts).

## Webhooks

- **`/api/webhooks/google-spend`** — verify HMAC / shared secret implementation before any “cleanup”; gaps are **P0**, not debt.

## Rate limits

Document which routes use `lib/services/rate-limit-service.ts`. **Never** throttle OCI export/ACK without an explicit product decision.

## Tenant isolation

Every route that accepts `site_id` / `public_id` must respect RLS or explicit guards. **`npm run test:tenant-boundary`** is the regression harness after refactors.
