# Third-party integrations inventory

| System | Code paths | Required in prod? |
|--------|------------|-------------------|
| Supabase (DB, Auth) | `lib/supabase/*`, all API routes | **Yes** |
| Upstash Redis | `lib/upstash.ts`, rate limits, metrics | **Yes** for cross-instance metrics / RL |
| Upstash QStash | `lib/qstash/*`, worker enqueue | **Yes** for async ingest path |
| Google APIs / Ads | `lib/providers/google_ads/*` (REST + token refresh URLs; no `googleapis` npm client) | **Yes** for OCI export |
| Sentry / GlitchTip | `@sentry/nextjs`, `instrumentation*.ts`, `sentry.*.config.ts` | Optional — build plugin removed; runtime SDK may remain until Phase P full decision |
| Telegram | `lib/services/telegram-service.ts` | Product-dependent |
| Watchtower | `lib/services/watchtower.ts`, `app/api/watchtower/*` | Operational monitoring |

**Dev-only / smoke:** `WATCHTOWER_TEST_THROW`, smoke scripts under `scripts/smoke/`.
