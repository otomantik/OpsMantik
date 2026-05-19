# Route matrix v2 — SEAL-00

**Inventory:** [API_ROUTE_INVENTORY.md](./API_ROUTE_INVENTORY.md) (107 routes, generated 2026-05-19)  
**Cut ladder:** see [CUT_MANIFEST.md](./CUT_MANIFEST.md)

Columns: Route | Purpose | Surface | Auth | Tenant guard | Service role? | PII | Prod exposure | Classification | Decision | Evidence | PR

---

## Sacred — ingest & public core

| Route | Purpose | Surface | Auth | Tenant | service_role | PII | Prod | Class | Decision | Evidence | PR |
|-------|---------|---------|------|--------|--------------|-----|------|-------|----------|----------|-----|
| `/api/sync` | Tracker ingest | public | site key / HMAC | site scope | selective | low metadata | yes | SACRED_PUBLIC_CORE | KEEP | 4 refs | — |
| `/api/call-event` | Call intent v1 | public | site auth | site | yes path | phone in body | yes | SACRED_PUBLIC_CORE | KEEP | ingest | — |
| `/api/call-event/v2` | Call intent v2 | public | site auth | site | yes | phone | yes | SACRED_PUBLIC_CORE | KEEP | ingest | — |
| `/api/gdpr/*` | Consent/erase/export | public/admin | user/session | site | yes | high | yes | SACRED_PUBLIC_CORE | KEEP | legal | — |
| `/api/health` | Liveness | public | none | n/a | no | no | yes | SACRED_PUBLIC_CORE | KEEP | ops | — |

## Sacred — OCI script API

| Route | Purpose | Surface | Auth | Tenant | service_role | PII | Prod | Class | Decision | Evidence | PR |
|-------|---------|---------|------|--------|--------------|-----|------|-------|----------|----------|-----|
| `/api/oci/google-ads-export` | Batch export | script | OCI key | per site batch | yes | hash only in payload | yes | SACRED_SCRIPT_API | KEEP | Universal.js | — |
| `/api/oci/ack` | Success ACK | script | OCI key | row id | yes | no | yes | SACRED_SCRIPT_API | KEEP | ≠ Google proof | — |
| `/api/oci/ack-failed` | Failure ACK | script | OCI key | row id | yes | no | yes | SACRED_SCRIPT_API | KEEP | FSM | — |
| `/api/oci/script-heartbeat` | Fleet health | script | OCI key | site | yes | no | yes | SACRED_SCRIPT_API | KEEP | watchtower | — |
| `/api/oci/v2/verify` | Script verify | script | OCI key | site | yes | no | yes | SACRED_SCRIPT_API | KEEP | install | — |
| `/api/workers/google-ads-oci` | Worker | internal | QStash | site | yes | no | yes | KEEP_INTERNAL_WORKER | KEEP | — | — |
| `/api/workers/oci/process-outbox` | Outbox worker | internal | QStash | site | yes | no | yes | KEEP_INTERNAL_WORKER | KEEP | outbox | — |

## Sacred — panel / operator

| Route | Purpose | Surface | Auth | Tenant | service_role | PII | Prod | Class | Decision | Evidence | PR |
|-------|---------|---------|------|--------|--------------|-----|------|-------|----------|----------|-----|
| `/api/intents/[id]/stage` | Stage mutation | panel | session + RBAC | validateSiteAccess | admin path | seal phone | yes | KEEP_PANEL_CORE | KEEP | panel-feed fetch | — |
| `/api/intents/[id]/status` | Status mutation | panel | session | yes | admin | low | yes | KEEP_PANEL_CORE | KEEP | panel-feed | — |
| `/api/intents/[id]/review` | Review | panel | session | yes | admin | low | yes | KEEP_PANEL_CORE | KEEP | — | — |
| `/api/calls/[id]/seal` | Won seal | panel | session | yes | admin | phone hash | yes | KEEP_PANEL_CORE | KEEP | panel-feed | — |
| `/api/sites/[siteId]/tracker-embed` | Install snippet | panel | session | yes | no | no | yes | KEEP_PANEL_CORE | KEEP | sites-manager | SEAL-07 |
| `/api/sites/[siteId]/origins/verify` | Origin check | panel | session | yes | no | no | yes | KEEP_PANEL_CORE | KEEP | install | SEAL-07 |
| `/api/oci/queue-stats` | OCI counts | panel/admin | session | yes | admin | aggregates | yes | KEEP_PANEL_CORE | KEEP | oci-control | SEAL-03 strip |
| `/api/oci/queue-rows` | Queue list | admin | session | yes | admin | no raw | yes | KEEP_ADMIN_ONLY | KEEP admin | — |
| `/api/oci/queue-actions` | Retry etc. | admin | session | yes | admin | no | yes | KEEP_ADMIN_ONLY | KEEP admin | — |

## Cron — core target (6 + invoice-freeze)

| Route | Purpose | Auth | service_role | Prod schedule | Class | Decision | PR |
|-------|---------|------|--------------|---------------|-------|----------|-----|
| `/api/cron/oci/process-outbox-events` | Outbox drain | CRON_SECRET | yes | 5m | KEEP_CRON_CORE | KEEP | — |
| `/api/cron/oci-maintenance` | Stuck/zombie | CRON_SECRET | yes | 10m | KEEP_CRON_CORE | KEEP | — |
| `/api/cron/night-maintenance` | Storage batches | CRON_SECRET | yes | 03:00 | KEEP_CRON_CORE | KEEP | — |
| `/api/cron/auto-junk` | Intent expiry | CRON_SECRET | yes | 02:00 | KEEP_CRON_CORE | KEEP | — |
| `/api/cron/watchtower` | SLO checks | CRON_SECRET | yes | 15m | KEEP_CRON_CORE | KEEP | — |
| `/api/cron/reconcile-usage` | Billing | CRON_SECRET | yes | 15m | KEEP_CRON_CORE | KEEP | — |
| `/api/cron/invoice-freeze` | Monthly freeze | CRON_SECRET | yes | monthly | KEEP_CRON_CORE | KEEP optional | — |

## Cron — OUT_OF_CORE (vercel remove CUT-02, handler keep)

| Route | Class | Decision | PR |
|-------|-------|----------|-----|
| `/api/cron/funnel-projection` | OUT_OF_CORE | vercel off | CUT-02 |
| `/api/cron/truth-parity-repair` | OUT_OF_CORE | vercel off | CUT-02 |
| `/api/cron/vacuum`, `oci-recovery` | INTERNAL_LAB | merge schedule into maintenance | CUT-02 |
| `/api/cron/idempotency-cleanup`, `outbox-cleanup`, `processed-signals-retention`, `retired-audit-cleanup (removed)`, `cleanup`, `gdpr-retention` | KEEP_CRON_CORE | absorbed by night-maintenance | CUT-02 |
| `/api/cron/oci/enqueue-from-sales` | BREAK_GLASS_ONLY | vercel off | CUT-02 |
| `/api/cron/providers/seed-credentials` | BREAK_GLASS_ONLY | never vercel | — |
| `/api/cron/test-notification` | BREAK_GLASS_ONLY | manual only | — |

## PROD_OFF — debug / test

| Route | Protection today | Class | Decision | PR |
|-------|------------------|-------|----------|-----|
| `/api/test-oci` | assertNotProductionDeployment | PROD_OFF | verify CI | CUT-01 |
| `/api/debug/realtime-signal` | prod 404 | PROD_OFF | verify | CUT-01 |
| `/api/watchtower/test-throw` | prod 404 | PROD_OFF | verify | CUT-01 |
| `/api/create-test-site` | prod 404 | PROD_OFF | admin only | CUT-01 |
| `/api/probe/register` | needs verify | PROD_OFF | gate | CUT-01 |

## OUT_OF_CORE — analytics / spend / CRM

| Route | Class | Decision | Evidence | PR |
|-------|-------|----------|----------|-----|
| `/api/webhooks/google-spend` | PROD_OFF → 410_GONE | disable | spend script URL only | CUT-01 |
| `/api/dashboard/spend` | PROD_OFF → 410_GONE | disable | module test | CUT-01 |
| `/api/stats/realtime` | PROD_OFF → 410_GONE | disable | perf script only | CUT-01 |
| `/api/stats/reconcile` | ADMIN_ONLY | keep admin | comment | — |
| `/api/reporting/dashboard-stats` | PROD_OFF → 410_GONE | disable | 0 refs | CUT-01 |
| `/api/conversations/*` (9) | ARCHIVE_AFTER_EVIDENCE | PROD_OFF first | 0 app refs | SEAL-06 |
| `/api/truth/explain/[callId]` | FEATURE_FLAG_ONLY | default off | EXPLAINABILITY flag | CUT-01 |
| `/api/jobs/auto-approve` | BREAK_GLASS_ONLY | document external cron | route comment | — |
| `/api/metrics`, `/api/admin/metrics` | ADMIN_ONLY | ops only | 0 panel | — |

## UNKNOWN — trace in SEAL-00 / before cut

| Route | Class | Notes |
|-------|-------|-------|
| `/api/sales/*` | UNKNOWN_NEEDS_TRACE | Align with seal/won SSOT |
| `/api/ops/stale-signals` | ADMIN_ONLY | ops tool |
| `/api/internal/worker/tenant-map` | KEEP_INTERNAL_WORKER | worker |
| `/api/billing/dispute-export` | KEEP_ADMIN_ONLY | billing |

---

**Full route list:** see generated inventory. Re-classify any `legacy_unknown` row when touching that route.
