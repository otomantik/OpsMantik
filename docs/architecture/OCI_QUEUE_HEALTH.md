# OCI queue health — alert thresholds (documentation)

**Purpose:** Operational guidance for `offline_conversion_queue` and `marketing_signals` stuck work. Values are **starting points** — tune per tenant traffic.

| Signal | Where | Suggested threshold | Action |
|--------|-------|---------------------|--------|
| Queue depth | [`GET /api/metrics`](../../app/api/metrics/route.ts) `funnel_kernel.legacy_queue_queued_retry` | Sustained increase vs 7d baseline | Check worker cron, Google API errors, [`OCI_GOOGLE_ADS_SCRIPT_CONTROL.md`](../runbooks/OCI_GOOGLE_ADS_SCRIPT_CONTROL.md) |
| PENDING marketing signals | DB / export dashboards | Rows `dispatch_status = 'PENDING'` aging > 24h without ACK | Script or API path; verify no dual-channel |
| Open funnel violations | `funnel_kernel.open_violations` in metrics | > 0 sustained | [FUNNEL_CONTRACT.md](./FUNNEL_CONTRACT.md), repair crons |

**Note:** Precise “stuck age” requires SQL (e.g. `min(created_at)` for QUEUED); extend `/api/metrics` in a follow-up if needed.
