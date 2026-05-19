# Cron contract matrix — SEAL-00 / CUT-02A

**Source:** [`vercel.json`](../../../vercel.json)  
**CUT-02A (merged):** **9** Vercel schedules (was 19). **No handler files deleted. No route handler edits.**  
**Rollback:** revert `vercel.json` only.

## Scheduled after CUT-02A (9)

| Cron | Schedule | Owner | Notes |
|------|----------|-------|-------|
| `/api/cron/oci/process-outbox-events` | `1-56/5 * * * *` | OCI | Outbox safety-net worker |
| `/api/cron/oci-maintenance` | `*/10 * * * *` | OCI | `runOciMaintenance` + bounded upload |
| `/api/cron/night-maintenance` | `0 3 * * *` | Storage | Idempotency → outbox → GDPR → processed_signals |
| `/api/cron/auto-junk` | `0 2 * * *` | Product | Intent `expires_at` junk |
| `/api/cron/watchtower` | `*/15 * * * *` | Ops | Ingest/OCI/billing diagnostics |
| `/api/cron/reconcile-usage` | `8,23,38,53 * * * *` | Billing | Enqueue + process |
| `/api/cron/invoice-freeze` | `0 0 1 * *` | Billing | Monthly freeze |
| `/api/cron/marketing-signals-cleanup` | `55 3 * * *` | Storage | **Kept until CUT-02B** — SENT 60d not in night yet |
| `/api/cron/cleanup` | `0 4 * * *` | Storage | **Kept until CUT-02B** — archive_failed + queue batch not in night yet |

## Removed from Vercel schedule in CUT-02A (handlers remain — break-glass)

| Path | Why removed from schedule | Manual invoke |
|------|---------------------------|---------------|
| `funnel-projection` | OUT_OF_CORE analytics | `GET` + `CRON_SECRET` |
| `truth-parity-repair` | Experimental parity repair | same |
| `idempotency-cleanup` | Covered by `night-maintenance` | `?apply=true` + approval env |
| `oci/outbox-cleanup` | Covered by night | same |
| `processed-signals-retention` | Covered by night | same |
| `gdpr-retention` | Duplicate anonymize RPC in night | same |
| `oci-recovery` | Largely superseded by `oci-maintenance` | same |
| `vacuum` | Product PENDING hygiene | same |
| `oci/ack-receipt-ttl` | TTL sweep; optional 02C merge | same |
| `oci/enqueue-from-sales` | Legacy sales enqueue | same |

## Not in vercel.json (break-glass only)

`process-offline-conversions`, `sweep-unsent-conversions`, `oci/sweep-zombies`, `recover-stuck-signals`, `promote-blocked-queue`, `backfill-precursor-signals`, `attempt-cap`, `providers/*`, `reconcile-usage/{enqueue,run,backfill}`, `test-notification`, plus all paths in the table above.

## Special rules

- **CUT-02A:** schedule-only — do not delete `app/api/cron/**/route.ts` without a later DELETE_AFTER_ONE_RELEASE PR.
- Night-maintenance mutations require `OPSMANTIK_STORAGE_CLEANUP_APPROVAL=I_APPROVE_STORAGE_MUTATION` when `apply=true`.
- Manual break-glass: `curl -H "Authorization: Bearer $CRON_SECRET" https://console.opsmantik.com/api/cron/<path>`

## Evidence

- Contract test: [`tests/unit/cron-schedule-contract.test.ts`](../../../tests/unit/cron-schedule-contract.test.ts)
- Locks: [`lib/cron/with-cron-lock.ts`](../../../lib/cron/with-cron-lock.ts)
- Night: [`app/api/cron/night-maintenance/route.ts`](../../../app/api/cron/night-maintenance/route.ts)
- Storage matrix: [`docs/architecture/OPS/STORAGE_RETENTION_MATRIX.md`](../OPS/STORAGE_RETENTION_MATRIX.md)
