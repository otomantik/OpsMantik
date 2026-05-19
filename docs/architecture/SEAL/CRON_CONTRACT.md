# Cron contract matrix — SEAL-00 / CUT-02A–02D

**Source:** [`vercel.json`](../../../vercel.json)  
**CUT-02A:** schedule diet `19 → 10` (handlers kept).  
**CUT-02B:** `cleanup` merged into `night-maintenance`; schedule **`7`**.  
**CUT-02C:** `sweep_stale_ack_receipts_v1` folded into `oci-maintenance` (`runOciMaintenance`).  
**CUT-02D:** unscheduled handlers `@deprecated` + break-glass appendix (this doc).  
**Rollback:** revert `vercel.json` (+ orchestrator route if needed).

## Scheduled after CUT-02B (7)

| Cron | Schedule | Owner | Notes |
|------|----------|-------|-------|
| `/api/cron/oci/process-outbox-events` | `1-56/5 * * * *` | OCI | Outbox safety-net worker |
| `/api/cron/oci-maintenance` | `*/10 * * * *` | OCI | `runOciMaintenance` + bounded upload |
| `/api/cron/night-maintenance` | `0 3 * * *` | Storage | Idempotency → outbox → GDPR → processed_signals → truth_evidence → **archive_failed** → **oci_queue** |
| `/api/cron/auto-junk` | `0 2 * * *` | Product | Untouched `intent` after **90d** (`expires_at`; skips `reviewed_at`) |
| `/api/cron/watchtower` | `*/15 * * * *` | Ops | Ingest/OCI/billing diagnostics |
| `/api/cron/reconcile-usage` | `8,23,38,53 * * * *` | Billing | Enqueue + process |
| `/api/cron/invoice-freeze` | `0 0 1 * *` | Billing | Monthly freeze |

## Removed from Vercel schedule (handlers remain — break-glass)

| Path | Why | Replacement |
|------|-----|-------------|
| `cleanup` | CUT-02B | **night-maintenance** phases `archive_failed` + `cleanup_oci_queue_batch` |
| `idempotency-cleanup`, `oci/outbox-cleanup`, `processed-signals-retention`, `gdpr-retention` | CUT-02A | **night-maintenance** |
| Legacy audit cleanup cron | Table retired | N/A |
| `funnel-projection`, `truth-parity-repair`, `oci-recovery`, `vacuum`, `oci/ack-receipt-ttl`, `oci/enqueue-from-sales` | CUT-02A/02C | Break-glass; OCI sweeps → **oci-maintenance** |
| Legacy OCI sweeps (`sweep-zombies`, `attempt-cap`, …) | CUT-02A/02C | **oci-maintenance** |
| Storage batch crons (`idempotency-cleanup`, `gdpr-retention`, …) | CUT-02A/02B | **night-maintenance** |
| `cleanup` | CUT-02B | **night-maintenance** (`archive_failed` + `oci_queue`) |

## Special rules

- Do not delete `app/api/cron/**/route.ts` without DELETE_AFTER_ONE_RELEASE PR.
- Unscheduled routes must keep `@deprecated CUT-02D` header pointing to replacement (see tests).
- Night-maintenance mutations require `OPSMANTIK_STORAGE_CLEANUP_APPROVAL=I_APPROVE_STORAGE_MUTATION` when `apply=true`.

## Break-glass manual invocation

**Auth (required):** `Authorization: Bearer $CRON_SECRET` **or** Vercel cron header (`x-vercel-cron` on platform invokes).

**Base URL:** `https://console.opsmantik.com` (production) or preview deployment host.

```bash
export CRON_SECRET='…'
export HOST='https://console.opsmantik.com'

# Read-only / dry-run (no storage approval)
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$HOST/api/cron/funnel-projection?dry_run=true"

# Night-maintenance storage mutations (apply)
export OPSMANTIK_STORAGE_CLEANUP_APPROVAL=I_APPROVE_STORAGE_MUTATION
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$HOST/api/cron/night-maintenance?apply=true"

# Legacy cleanup route (deprecated; prefer night-maintenance)
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$HOST/api/cron/cleanup?apply=true"

# OCI maintenance orchestrator (includes ack-receipt TTL sweep CUT-02C)
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$HOST/api/cron/oci-maintenance"
```

| Route | Replacement | Notes |
|-------|-------------|-------|
| `/api/cron/oci/ack-receipt-ttl` | `oci-maintenance` | CUT-02C — RPC in `runOciMaintenance` |
| `/api/cron/cleanup` | `night-maintenance` | CUT-02B |
| `/api/cron/idempotency-cleanup`, `oci/outbox-cleanup`, `gdpr-retention`, `processed-signals-retention` | `night-maintenance` | CUT-02A |
| `/api/cron/oci/sweep-zombies`, `oci/attempt-cap`, `oci-recovery`, … | `oci-maintenance` | CUT-02A |
| `/api/cron/funnel-projection`, `truth-parity-repair`, `vacuum` | manual only | OUT_OF_CORE / hygiene |
| `/api/cron/reconcile-usage/enqueue`, `run`, `backfill` | `reconcile-usage` | Sub-actions of scheduled parent |

**Rollback schedule:** revert `vercel.json` on `master` and redeploy; handlers remain for break-glass.

## Evidence

- [`tests/unit/cron-schedule-contract.test.ts`](../../../tests/unit/cron-schedule-contract.test.ts)
- [`tests/unit/night-maintenance-cut-02b.test.ts`](../../../tests/unit/night-maintenance-cut-02b.test.ts)
- [`tests/unit/oci-maintenance-cut-02c.test.ts`](../../../tests/unit/oci-maintenance-cut-02c.test.ts)
- [`tests/unit/cron-break-glass-deprecation.test.ts`](../../../tests/unit/cron-break-glass-deprecation.test.ts)
- [`app/api/cron/night-maintenance/route.ts`](../../../app/api/cron/night-maintenance/route.ts)
