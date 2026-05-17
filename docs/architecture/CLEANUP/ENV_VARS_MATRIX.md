# Environment variables matrix (starter)

**Canonical template:** [`.env.local.example`](../../.env.local.example) at repo root.

This matrix is **not** a full automated dump of every `process.env` read site — maintain it incrementally when adding routes or workers.

## Buckets

| Bucket | Examples | Consumers |
|--------|----------|-----------|
| Supabase public | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server components + middleware |
| Supabase privileged | `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `SUPABASE_POOLER_URL` | `lib/supabase/admin`, scripts |
| OCI / script | `OCI_API_KEY`, `OCI_CONVERSION_NAME`, signing keys | `app/api/oci/*`, `app/api/call-event*` |
| Cron | `CRON_SECRET` | `app/api/cron/*` |
| QStash / workers | QStash signing secrets, `NEXT_PUBLIC_APP_URL` | `lib/qstash`, worker routes |
| Redis / billing | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | metrics, rate limits |
| Observability | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_*` | `@sentry/nextjs`, instrumentation |
| Feature / safety | `OPSMANTIK_*`, `WATCHTOWER_TEST_THROW` | various guards |

## Dead env policy

1. `grep -r "process.env.MY_VAR"` → zero hits in `app`, `lib`, `scripts` → candidate for removal from `.env.local.example` **after** confirming Vercel/Supabase dashboards do not still inject it.

## Rotation

OCI and cron secrets: pair any change with [`GOVERNANCE_ADR_AND_ROLLBACK.md`](./GOVERNANCE_ADR_AND_ROLLBACK.md) rollback steps (revert deploy + restore prior secret version).
