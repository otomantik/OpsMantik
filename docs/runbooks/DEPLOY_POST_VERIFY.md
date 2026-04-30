# Deploy — 2 minute verification

Run after each production deploy (or hotfix).

| Step | Command / action | Pass criteria |
|------|-------------------|---------------|
| 1 | `GET https://<console>/api/health` | `ok: true`, `db_ok: true` (if DB configured) |
| 2 | `GET /api/metrics` with cron `Authorization: Bearer <CRON_SECRET>` | JSON includes `routes.sync`, `billing`, `meta.timestamp` |
| 3 | (Optional) `npm run smoke:intent-multi-site` from CI machine with secrets | 2/2 site PASS per [DEPLOY_GATE_INTENT](../OPS/DEPLOY_GATE_INTENT.md) |
| 4 | Spot-check Sentry | No new spike in `tags.route:/api/sync` or `/api/call-event/v2` |

If step 1 fails: check Supabase + `NEXT_PUBLIC_SUPABASE_*` on Vercel.

If `routes.source` is `memory` in metrics: Redis may be down — see [INFRA_REDIS_QSTASH_CHECKLIST.md](./INFRA_REDIS_QSTASH_CHECKLIST.md).

If **`POST /api/sync`** returns **503** with `Ingest temporarily unavailable` and response header **`x-opsmantik-degraded: qstash_publish_failed`**: QStash could not enqueue the worker job. Check **Vercel → Environment**: `QSTASH_TOKEN`, signing keys, and **`NEXT_PUBLIC_APP_URL`** = full console origin (e.g. `https://console.opsmantik.com`). Without an absolute worker URL, enqueue fails and intent/sync stops. Vercel also sets `VERCEL_URL`; the app uses it as fallback when building the worker URL for QStash.

OCI script lane quick checks:
- `GET /api/oci/google-ads-export?siteId=<id>&limit=200` returns `data` and `meta.hasNextPage`.
- `POST /api/oci/ack` accepts granular `results[]` and mixed success/failure rows in one request.

Intent stabilization quick checks (when `INTENT_REVIEWED_FILTER_ENABLED` rollout is active):
- Create one new intent and verify it appears in default `Gorulmemis` queue.
- Mark it as reviewed (`POST /api/intents/:id/review`) and verify it disappears from default queue.
- Verify the same row appears in `Girilenler` (Recent Entered, last 50).
- Undo to intent (`POST /api/intents/:id/status` with `status=intent`) and verify it reappears in default queue.
- Repeat the same insert payload in a short window and verify no second visible row is rendered (canonical dedupe path).

Feature flag notes:
- Client gate: `NEXT_PUBLIC_INTENT_REVIEWED_FILTER_ENABLED=true`
- Server gate reference: `INTENT_REVIEWED_FILTER_ENABLED=true` (ops runbook alignment)
