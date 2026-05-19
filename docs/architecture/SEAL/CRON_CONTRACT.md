# Cron contract matrix — SEAL-00

**Source:** [`vercel.json`](../../../vercel.json) (**19** schedules as of 2026-05-19; counted `crons[].path`)  
**Final target:** **6 core** + **optional** monthly `invoice-freeze` (7th schedule, not counted in six)

## Retained core (target state — CUT-02)

| Cron | Frequency | Owner | Lock | Heartbeat | Idempotent | Max runtime | Max batch | Failure visibility | Rollback |
|------|-----------|-------|------|-----------|------------|-------------|-----------|-------------------|----------|
| `/api/cron/oci/process-outbox-events` | 5m | OCI | yes | partial | claim loop | 300s | ~50 claims | metrics + logs | restore vercel row |
| `/api/cron/oci-maintenance` | 10m | OCI | yes | yes | yes | 300s | per `run-maintenance` | FAIL in heartbeat | restore row |
| `/api/cron/night-maintenance` | 03:00 UTC | Storage | yes (`night-maintenance`) | yes | batch RPCs | 300s | 5k×loops | PARTIAL JSON | disable `OPSMANTIK_STORAGE_CLEANUP_APPROVAL` |
| `/api/cron/auto-junk` | 02:00 | Product | optional | yes | yes | 120s | 500 sites | PASS/PARTIAL | restore row |
| `/api/cron/watchtower` | 15m | Ops | no | partial | yes | 60s | counts | WARN logs | restore row |
| `/api/cron/reconcile-usage` | 15m stagger | Billing | yes | yes | yes | 600s | 50 jobs | BILLING_* metrics | restore row |
| `/api/cron/invoice-freeze` | monthly `0 0 1 * *` | Billing | yes | yes | yes | 300s | all sites | FAIL alert | restore row (**optional 7th**) |

## Currently scheduled — remove from vercel in CUT-02 (handlers kept)

| Removed (from target core) | Why | Merge into | Break-glass | Rollback |
|----------------------------|-----|------------|-------------|----------|
| `idempotency-cleanup` | Overlap | `night-maintenance` | manual GET+`?apply=true` | re-add stagger row |
| `oci/outbox-cleanup` | Overlap | `night-maintenance` | same | re-add |
| `processed-signals-retention` | Overlap | `night-maintenance` | same | re-add |
| `marketing-signals-cleanup` | Overlap | `night-maintenance` | same | re-add |
| `cleanup` (4-phase) | Overlap | night + auto-junk + oci-maintenance | `?recovery_junk=true` on cleanup route | re-add |
| `gdpr-retention` | Overlap | night-maintenance phase | manual route | re-add |
| `oci-recovery` | Overlap | `oci-maintenance` | manual invoke | re-add |
| `vacuum` | Overlap | oci-maintenance | manual | re-add |
| `funnel-projection` | OUT_OF_CORE writes | — (stop) | manual | re-add if reporting revived |
| `truth-parity-repair` | Experimental | — | manual + flag off | re-add |
| `oci/enqueue-from-sales` | Legacy sales path | document / break-glass | manual | re-add if needed |
| `oci/ack-receipt-ttl` | TTL hygiene | oci-maintenance or night | manual | re-add |

## Not in vercel.json (break-glass only)

`process-offline-conversions`, `sweep-unsent-conversions`, `oci/sweep-zombies`, `recover-stuck-signals`, `promote-blocked-queue`, `backfill-precursor-signals`, `attempt-cap`, `providers/*`, `reconcile-usage/{enqueue,run,backfill}`, `test-notification`

## Special rules

- Do **not** delete handler files in CUT-02 — remove schedule only; `@deprecated` header for one release.
- Do **not** merge `oci-recovery` into maintenance without lock + attempt cap + observability (already on maintenance path).
- Night-maintenance mutations require `OPSMANTIK_STORAGE_CLEANUP_APPROVAL=I_APPROVE_STORAGE_MUTATION` when `apply=true`.

## Evidence

- Locks: [`lib/cron/with-cron-lock.ts`](../../../lib/cron/with-cron-lock.ts), `LEASE_LOCK_MODE=lease` default
- Night: [`app/api/cron/night-maintenance/route.ts`](../../../app/api/cron/night-maintenance/route.ts)
- Storage matrix: [`docs/architecture/OPS/STORAGE_RETENTION_MATRIX.md`](../OPS/STORAGE_RETENTION_MATRIX.md)
