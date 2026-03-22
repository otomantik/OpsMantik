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
