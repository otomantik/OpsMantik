# Cron contract matrix — SEAL-00 / CUT-02A / CUT-02B

**Source:** [`vercel.json`](../../../vercel.json)  
**CUT-02A:** schedule diet `19 → 10` (handlers kept).  
**CUT-02B (implemented):** `cleanup` merged into `night-maintenance`; schedule **`7`**.  
**Rollback:** revert `vercel.json` (+ night-maintenance route if needed).

## Scheduled after CUT-02B (7)

| Cron | Schedule | Owner | Notes |
|------|----------|-------|-------|
| `/api/cron/oci/process-outbox-events` | `1-56/5 * * * *` | OCI | Outbox safety-net worker |
| `/api/cron/oci-maintenance` | `*/10 * * * *` | OCI | `runOciMaintenance` + bounded upload |
| `/api/cron/night-maintenance` | `0 3 * * *` | Storage | Idempotency → outbox → GDPR → processed_signals → truth_evidence → **archive_failed** → **oci_queue** |
| `/api/cron/auto-junk` | `0 2 * * *` | Product | Intent `expires_at` junk |
| `/api/cron/watchtower` | `*/15 * * * *` | Ops | Ingest/OCI/billing diagnostics |
| `/api/cron/reconcile-usage` | `8,23,38,53 * * * *` | Billing | Enqueue + process |
| `/api/cron/invoice-freeze` | `0 0 1 * *` | Billing | Monthly freeze |

## Removed from Vercel schedule (handlers remain — break-glass)

| Path | Why | Replacement |
|------|-----|-------------|
| `cleanup` | CUT-02B | **night-maintenance** phases `archive_failed` + `cleanup_oci_queue_batch` |
| `idempotency-cleanup`, `oci/outbox-cleanup`, `processed-signals-retention`, `gdpr-retention` | CUT-02A | **night-maintenance** |
| Legacy audit cleanup cron | Table retired | N/A |
| `funnel-projection`, `truth-parity-repair`, `oci-recovery`, `vacuum`, `oci/ack-receipt-ttl`, `oci/enqueue-from-sales` | CUT-02A | Manual / oci-maintenance |

## Special rules

- Do not delete `app/api/cron/**/route.ts` without DELETE_AFTER_ONE_RELEASE PR.
- Night-maintenance mutations require `OPSMANTIK_STORAGE_CLEANUP_APPROVAL=I_APPROVE_STORAGE_MUTATION` when `apply=true`.
- Manual break-glass: `curl -H "Authorization: Bearer $CRON_SECRET" https://console.opsmantik.com/api/cron/<path>`

## Evidence

- [`tests/unit/cron-schedule-contract.test.ts`](../../../tests/unit/cron-schedule-contract.test.ts)
- [`tests/unit/night-maintenance-cut-02b.test.ts`](../../../tests/unit/night-maintenance-cut-02b.test.ts)
- [`app/api/cron/night-maintenance/route.ts`](../../../app/api/cron/night-maintenance/route.ts)
