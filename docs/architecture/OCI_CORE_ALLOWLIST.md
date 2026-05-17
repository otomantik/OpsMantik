# OCI core allowlist (do not break without ADR + release gates)

These paths are the **minimal production spine** for tracker → ingest → queue → Google Ads offline conversion (export + ACK). Changes here require `npm run test:release-gates` green and an ADR for breaking API or schema shifts.

## Public / script ingest

| Route | Role |
|-------|------|
| `POST /api/call-event` | Legacy ingest entry |
| `POST /api/call-event/v2` | Versioned ingest |
| `GET/POST /api/health` | Liveness + signing policy warnings |

## OCI export / ACK / queue

| Route | Role |
|-------|------|
| `POST /api/oci/ack` | Script ACK |
| `POST /api/oci/ack-failed` | Failed ACK / DLQ-style handling |
| `GET/POST /api/oci/google-ads-export` | Export batch to Google Ads script |
| `POST /api/workers/google-ads-oci` | Worker drain / batch processing |
| `POST /api/workers/oci/process-outbox` | Outbox processor (if deployed) |
| `GET /api/oci/v2/verify` | Script verification handshake (as used by fleet) |

## Cron (subset — Vercel-scheduled OCI maintenance)

Exact schedules live in [`vercel.json`](../../vercel.json). Treat at least these as OCI-adjacent:

- `/api/cron/oci/process-outbox-events`
- `/api/cron/oci/outbox-cleanup`
- `/api/cron/oci/ack-receipt-ttl`
- `/api/cron/oci-maintenance`
- `/api/cron/oci-recovery`
- `/api/cron/oci/sweep-zombies`
- `/api/cron/oci/promote-blocked-queue`
- `/api/cron/oci/attempt-cap`
- `/api/cron/oci/recover-stuck-signals`
- `/api/cron/oci/enqueue-from-sales` (when sales → queue bridge is in use)

Other cron routes may be billing, GDPR, or watchtower — see [`CLEANUP/CRON_VERCEL_MATRIX.md`](./CLEANUP/CRON_VERCEL_MATRIX.md).

## Site / tracker operator surfaces

| Route | Role |
|-------|------|
| `GET /api/sites/[siteId]/tracker-embed` | Embed snippet / config for customer sites |
| `GET /api/sites/[siteId]/status` | Site health for operators (as linked from dashboard) |

## Non-goals

- Panel UI routes (`/panel`, `/dashboard`) are **not** OCI_core; they may be slimmed under a separate UI phase.
- Admin metrics and watchtower routes are operational; do not remove without proving zero dependency in prod.
