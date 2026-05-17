# Threat model — API surface classes

Fill one row per `app/api/**/route.ts` over time. Classes:

| Class | Meaning |
|-------|---------|
| `public_anon` | No session; may use site secret / API key |
| `api_key_script` | Google Ads script or OCI key (`x-api-key`) |
| `session_user` | Cookie session (Supabase) |
| `service_role_cron` | `CRON_SECRET` bearer |
| `internal_webhook` | Shared-secret or signed webhook |

## Webhooks

- **`/api/webhooks/google-spend`** — verify HMAC / shared secret implementation before any “cleanup”; gaps are **P0**, not debt.

## Rate limits

Document which routes use `lib/services/rate-limit-service.ts`. **Never** throttle OCI export/ACK without an explicit product decision.

## Tenant isolation

Every route that accepts `site_id` / `public_id` must respect RLS or explicit guards. **`npm run test:tenant-boundary`** is the regression harness after refactors.
