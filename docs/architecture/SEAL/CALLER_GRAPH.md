# Caller graph evidence — SEAL-00

**Method:** `rg` in `app/`, `components/`, `lib/`, `tests/`, `docs/`, `vercel.json`, `package.json`  
**Date:** 2026-05-19  
**Re-verified:** 2026-05-19 (finalize) — `fetch()` to spend/stats/conversations/reporting: **0** in `app/` + `components/`.

## Summary

| Candidate | Static imports (app+components) | fetch() callers | Test callers | Docs | vercel.json | Decision |
|-----------|--------------------------------|-----------------|--------------|------|-------------|----------|
| `/api/conversations/*` | 0 | 0 | `tests/unit/conversations-api.test.ts` | minimal | no | **ARCHIVE_AFTER_EVIDENCE** — PROD_OFF first |
| `/api/dashboard/spend` | 0 | 0 | `tests/unit/dashboard-spend-route.test.ts` | spend script | no | **PROD_OFF → 410_GONE** CUT-01 |
| `/api/webhooks/google-spend` | 0 | 0 | unit tests | `GoogleAdsScript.js` URL | no | **PROD_OFF → 410_GONE** CUT-01 |
| `/api/reporting/dashboard-stats` | 0 | 0 | none found | none | no | **PROD_OFF → 410_GONE** CUT-01 |
| `/api/stats/realtime` | 0 | 0 | perf script only | CLEANUP | no | **PROD_OFF → 410_GONE** CUT-01 |
| `/api/stats/reconcile` | 0 | 0 | admin comment | CLEANUP | no | **ADMIN_ONLY** |
| `useFunnelAnalytics` / `CROInsights` | `dashboard-shell.tsx` | N/A (hook internal) | none | none | N/A | **Remove from dashboard-shell** CUT-01 |
| `/api/truth/explain/[callId]` | 0 | 0 | flag tests | flags.ts | no | **FEATURE_FLAG_ONLY** |
| `/api/cron/funnel-projection` | 0 | 0 | cron tests | plan | **yes** 5m | **vercel remove** CUT-02 |
| `/api/cron/truth-parity-repair` | 0 | 0 | yes | plan | **yes** 10m | **vercel remove** CUT-02 |
| `/api/jobs/auto-approve` | 0 | 0 | none | route comment (external cron) | no | **BREAK_GLASS_ONLY** — document; no panel |
| `/api/test-oci` | 0 | 0 | prod guard test | yes | no | **PROD_OFF** (already gated) |
| `/api/debug/realtime-signal` | 0 | 0 | prod guard | yes | no | **PROD_OFF** |
| `/api/create-test-site` | 1 (`site-setup.tsx`) | 1 | prod guard | yes | no | **PROD_OFF** admin path only |
| `/api/probe/register` | 0 | 0 | unknown | CLEANUP | no | **PROD_OFF** |
| `/api/oci/queue-*` | oci-control-panel | 3 fetches | many | OCI docs | no | **KEEP_PANEL_CORE** (admin OCI UI; not in `/panel` v1 yet) |

## Sacred path callers (must keep)

| Route | fetch / usage |
|-------|----------------|
| `/api/sync` | tracker / ingest (4 refs in inventory script) |
| `/api/intents/[id]/stage` | [`panel-feed.tsx`](../../../components/dashboard/panel-feed.tsx) |
| `/api/intents/[id]/status` | `panel-feed.tsx` |
| `/api/calls/[id]/seal` | `panel-feed.tsx` |
| `/api/sites/list` | `site-switcher`, `sites-manager` |
| `/api/sites/[siteId]/tracker-embed` | `sites-manager` |
| `/api/oci/google-ads-export` | Apps Script (external) |
| `/api/oci/ack`, `ack-failed` | Apps Script (external) |

## Panel v1 import boundary (current)

`/app/panel/**` — **no** `useFunnelAnalytics`, `CROInsights`, spend, conversations, truth explain (verified SEAL-00).

## Re-run before CUT-01

```bash
rg "/api/conversations" app components lib --glob "*.{ts,tsx}"
rg "/api/dashboard/spend" app components
rg "reporting/dashboard-stats" app components
rg "/api/stats/" app components
rg "useFunnelAnalytics|CROInsights" app components
rg "google-spend" app scripts vercel.json
```
