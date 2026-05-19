# PR-OM-CUT-02A — Cron Kemik Implementation Plan

**Status:** **CUT-02A ✅** · **CUT-02B ✅** (**7** schedules) · **CUT-02C ✅** (ack TTL → oci-maintenance) · **CUT-02D ✅** (break-glass docs + `@deprecated`).  
**Prerequisite:** CUT-01 family complete on `master` (`510e36c`).  
**Scope ladder:** 02A ✅ → 02B ✅ → 02C ✅ → 02D ✅ — cron kemik complete.

**CUT-02A result:** No handler files edited. No route deletes. No migrations. Rollback = revert `vercel.json`.

---

## Current Cron Truth

**`vercel.json` schedules:** 19  
**`app/api/cron/**/route.ts` handlers:** 32 (many break-glass-only, not scheduled)

| Cron route | In vercel.json? | Schedule | Purpose | Lock? | Heartbeat? | Idempotent? | Core? | Decision |
|---|---:|---|---|---|---|---|---|---|
| `/api/cron/oci/process-outbox-events` | yes | `1-56/5 * * * *` | Claim/process `outbox_events` (IntentSealed safety net) | yes | partial | claim loop | **yes** | **KEEP_CORE** |
| `/api/cron/oci-maintenance` | yes | `*/10 * * * *` | `runOciMaintenance` + bounded upload runner (zombie/stuck/attempt-cap/orphans) | yes | yes | yes | **yes** | **KEEP_CORE** |
| `/api/cron/night-maintenance` | yes | `0 3 * * *` | Serial storage: idempotency → outbox → GDPR anonymize → processed_signals | yes | yes | batch RPCs | **yes** | **KEEP_CORE** |
| `/api/cron/auto-junk` | yes | `0 2 * * *` | Site-scoped intent `expires_at` junk | no | partial | yes | **yes** | **KEEP_CORE** |
| `/api/cron/watchtower` | yes | `*/15 * * * *` | Ingest/OCI/billing diagnostics | no | partial | yes | **yes** | **KEEP_CORE** |
| `/api/cron/reconcile-usage` | yes | `8,23,38,53 * * * *` | Billing enqueue + process jobs | yes | partial | yes | **yes** | **KEEP_CORE** (normalize schedule in 02A) |
| `/api/cron/invoice-freeze` | yes | `0 0 1 * *` | Monthly billing freeze | yes | yes | yes | monthly | **KEEP_MONTHLY** |
| `/api/cron/idempotency-cleanup` | yes | `10 3 * * *` | `delete_expired_idempotency_batch` | yes | yes | batch | no | **PROD_OFF_FROM_VERCEL** — covered by night-maintenance |
| `/api/cron/oci/outbox-cleanup` | yes | `25 3 * * *` | `delete_outbox_processed_batch` | partial | yes | batch | no | **PROD_OFF_FROM_VERCEL** — covered by night-maintenance |
| `/api/cron/processed-signals-retention` | yes | `40 3 * * *` | stale fail + delete processed_signals | yes | yes | batch | no | **PROD_OFF_FROM_VERCEL** — covered by night-maintenance |
| `/api/cron/retired-audit-cleanup (removed)` | yes | `55 3 * * *` | `cleanup_offline_conversion_queue_batch` (SENT 60d) | yes | yes | batch | no | **DEFER** — **not** in night-maintenance; remove only after 02B extends night |
| `/api/cron/gdpr-retention` | yes | `30 5 * * *` | `anonymize_consent_less_data_batch` | yes | yes | batch | no | **PROD_OFF_FROM_VERCEL** — duplicate RPC in night-maintenance |
| `/api/cron/oci-recovery` | yes | `*/30 * * * *` | `recover_stuck_offline_conversion_jobs` (30m) | no | yes | RPC | partial | **PROD_OFF_FROM_VERCEL** — largely superseded by oci-maintenance; monitor 1 release |
| `/api/cron/vacuum` | yes | `4-59/10 * * * *` | `runVacuum` — PENDING stall / geo purge | yes | no | yes | no | **PROD_OFF_FROM_VERCEL** — product hygiene; break-glass manual |
| `/api/cron/cleanup` | yes | `0 4 * * *` | 4-phase: zombie, archive FAILED, delete terminal OCI queue | yes | yes | batch | no | **DEFER** — `archive_failed` + `cleanup_oci_queue_batch` **not** in night; 02B or keep schedule |
| `/api/cron/funnel-projection` | yes | `2-57/5 * * * *` | `call_funnel_projection` reducer | no | no | batch | no | **PROD_OFF_FROM_VERCEL** — OUT_OF_CORE analytics |
| `/api/cron/truth-parity-repair` | yes | `3-58/10 * * * *` | Truth parity repair batch | yes | no | batch | no | **PROD_OFF_FROM_VERCEL** — experimental / OUT_OF_CORE |
| `/api/cron/oci/ack-receipt-ttl` | yes | `0 */6 * * *` | `sweep_stale_ack_receipts_v1` | no | yes | sweep | partial | **PROD_OFF_FROM_VERCEL** — break-glass; consider 02C merge into maintenance |
| `/api/cron/oci/enqueue-from-sales` | yes | `0 * * * *` | Legacy sales → queue enqueue | no | no | hourly | no | **PROD_OFF_FROM_VERCEL** — legacy path; manual only |

### Handlers not in `vercel.json` (break-glass today)

| Route | Purpose | Decision |
|---|---|---|
| `process-offline-conversions` | Legacy runner | **BREAK_GLASS_ONLY** |
| `sweep-unsent-conversions` | Merged into `runOciMaintenance` | **BREAK_GLASS_ONLY** |
| `oci/sweep-zombies`, `recover-stuck-signals`, `attempt-cap`, `promote-blocked-queue`, `backfill-precursor-signals` | Legacy OCI sweeps | **BREAK_GLASS_ONLY** |
| `providers/recover-processing`, `providers/seed-credentials` | Provider ops | **BREAK_GLASS_ONLY** |
| `reconcile-usage/enqueue`, `run`, `backfill` | Sub-actions of unified reconcile | **BREAK_GLASS_ONLY** (parent scheduled) |
| `test-notification` | Dev/test | **BREAK_GLASS_ONLY** |

---

## Target Cron Surface (CUT-02A goal)

**Scheduled jobs:** 7 (6 core + monthly invoice-freeze)

```json
{
  "crons": [
    { "path": "/api/cron/oci/process-outbox-events", "schedule": "1-56/5 * * * *" },
    { "path": "/api/cron/oci-maintenance", "schedule": "*/10 * * * *" },
    { "path": "/api/cron/watchtower", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/reconcile-usage", "schedule": "8,23,38,53 * * * *" },
    { "path": "/api/cron/auto-junk", "schedule": "0 2 * * *" },
    { "path": "/api/cron/night-maintenance", "schedule": "0 3 * * *" },
    { "path": "/api/cron/invoice-freeze", "schedule": "0 0 1 * *" }
  ]
}
```

**Note:** Keep staggered `reconcile-usage` unless billing ops requests `*/15`. Do **not** change handler code in 02A.

---

## Removed Schedule Candidates (CUT-02A safe set)

| Route | Safe in 02A? | Evidence |
|---|---|---|
| `funnel-projection` | **yes** | OUT_OF_CORE; CUT_MANIFEST; no sacred ingest dependency |
| `truth-parity-repair` | **yes** | Experimental; `TRUTH_PARITY_MODE` default detect; not queue FSM |
| `idempotency-cleanup` | **yes** | Same RPC as night-maintenance phase 1 |
| `oci/outbox-cleanup` | **yes** | Same RPC as night-maintenance phase 2 |
| `processed-signals-retention` | **yes** | Same RPCs as night-maintenance phases 4–5 |
| `gdpr-retention` | **yes** | Same `anonymize_consent_less_data_batch` as night phase 3 |
| `oci-recovery` | **yes*** | Overlap with `runOciMaintenance`; *watch orphan metrics 1 release |
| `oci/ack-receipt-ttl` | **yes*** | Low volume TTL sweep; manual break-glass OK; *optional 02C merge |
| `oci/enqueue-from-sales` | **yes** | Legacy; seal/sync paths own enqueue |
| `vacuum` | **yes*** | Product PENDING hygiene; not OCI export; manual if needed |

### DEFER out of CUT-02A (do not remove schedule yet)

| Route | Why defer |
|---|---|
| `retired-audit-cleanup (removed)` | **Not** in night-maintenance; only PROCESSING rescue in oci-maintenance. SENT 60d delete needs night phase or stays scheduled. |
| `cleanup` (4-phase) | `archive_failed_conversions_batch` + `cleanup_oci_queue_batch` not in night-maintenance. Removing risks storage growth. **02B** must add phases or keep `0 4 * * *` row. |

---

## Keep / Remove / Defer Decisions

| Classification | Routes |
|---|---|
| **KEEP_CORE** | process-outbox-events, oci-maintenance, night-maintenance, auto-junk, watchtower, reconcile-usage |
| **KEEP_MONTHLY** | invoice-freeze (scheduled; break-glass manual OK) |
| **PROD_OFF_FROM_VERCEL (02A)** | funnel-projection, truth-parity-repair, idempotency-cleanup, outbox-cleanup, processed-signals-retention, gdpr-retention, oci-recovery, ack-receipt-ttl, enqueue-from-sales, vacuum |
| **DEFER (02B)** | retired-audit-cleanup (removed), cleanup |
| **BREAK_GLASS_ONLY** | All unscheduled `app/api/cron/**` handlers — no file deletes |

---

## CUT-02 Risk Matrix

| Removed schedule | Risk if removed | Existing replacement | Evidence | Rollback |
|---|---|---|---|---|
| `funnel-projection` | Stale funnel projection table | None required (OUT_OF_CORE) | CUT-01B removed UI; manifest | Re-add vercel row |
| `truth-parity-repair` | Parity drift undetected | Manual + flag | Default detect mode | Re-add row |
| `idempotency-cleanup` | Idempotency table growth | **night-maintenance** `delete_expired_idempotency_batch` | `night-maintenance/route.ts` L79–88 | Re-add stagger row |
| `oci/outbox-cleanup` | Outbox PROCESSED bloat | **night-maintenance** `delete_outbox_processed_batch` | L97–106 | Re-add row |
| `processed-signals-retention` | Dedup table growth | **night-maintenance** fail_stale + delete batches | L120–138 | Re-add row |
| `retired-audit-cleanup (removed)` | SENT row retention stops | **None today** — oci-maintenance only rescues PROCESSING | STORAGE_RETENTION_MATRIX | **Do not remove in 02A**; extend night in 02B |
| `cleanup` | FAILED archive + terminal queue delete stop | Partial overlap with maintenance; **not full** | `cleanup/route.ts` phases 2–3 | **Defer**; re-add row if 02B not ready |
| `gdpr-retention` | Duplicate run only | **night-maintenance** anonymize phase | Same RPC | Re-add row (redundant) |
| `oci-recovery` | Less frequent stuck-job recovery | **oci-maintenance** `runOciMaintenance` | `run-maintenance.ts` header | Re-add `*/30` row |
| `vacuum` | PENDING cards not auto-stalled | Manual `GET /api/cron/vacuum` | `vacuum-worker` | Re-add row |
| `oci/ack-receipt-ttl` | Stale ack receipts accumulate | Manual invoke; optional 02C | Standalone RPC | Re-add `0 */6` row |
| `oci/enqueue-from-sales` | Missed legacy sales enqueue | Seal / ingest enqueue paths | Hourly legacy route | Re-add row |

**Stuck queue risk:** Removing `oci-recovery` schedule is acceptable if `oci-maintenance` every 10m remains; it already runs recovery primitives. Watch `OCI_ORPHAN_CLAIM_DETECTED` logs after deploy.

**Legal retention:** `gdpr-retention` duplicate of night — safe to unschedule. Row DELETE for sessions/events remains **not automated** per STORAGE_RETENTION_MATRIX red lines.

---

## CUT-02 split plan

### CUT-02A — Cron Schedule Diet (this PR)

- **Edit only:** `vercel.json`, `docs/architecture/SEAL/CRON_CONTRACT.md`, `docs/architecture/SEAL/CUT_02_CRON_PLAN.md`, `tests/unit/cron-schedule-contract.test.ts`
- Remove **10** vercel rows (safe set above); **keep** `retired-audit-cleanup (removed)` + `cleanup` until 02B
- **Resulting schedule count:** 19 − 10 = **9** (or 19 − 12 = **7** if defer pair removed later in 02B)

### CUT-02B — Night Maintenance Consolidation Hardening ✅

- Added night phases: `archive_failed_conversions_batch` + `cleanup_oci_queue_batch`
- Removed `/api/cron/cleanup` from `vercel.json` (7 schedules)
- Tests: `night-maintenance-cut-02b.test.ts`, updated `cron-schedule-contract.test.ts`
- Retired audit table cleanup N/A (table dropped)

### CUT-02C — OCI Maintenance Consolidation Hardening ✅

- `step_ackReceiptStaleSweep` in `run-maintenance.ts` (`sweep_stale_ack_receipts_v1`, 60m / 500 limit)
- `ack-receipt-ttl` route `@deprecated`; tests: `oci-maintenance-cut-02c.test.ts`

### CUT-02D — Break-glass Docs + Manual Routes ✅

- `CRON_CONTRACT.md` break-glass appendix (Bearer `CRON_SECRET`, `?apply=true`, approval env)
- `@deprecated` on all unscheduled routes; test: `cron-break-glass-deprecation.test.ts`
- Stamp helper: `scripts/ci/stamp-break-glass-deprecation.mjs` (idempotent)

---

## Exact Files for CUT-02A

| File | Action |
|---|---|
| `vercel.json` | Remove 10 safe schedule entries |
| `docs/architecture/SEAL/CRON_CONTRACT.md` | Sync table to post-02A truth |
| `docs/architecture/SEAL/CUT_02_CRON_PLAN.md` | This document (update status after merge) |
| `tests/unit/cron-schedule-contract.test.ts` | **Create** — pin allowed paths |

**No edits:** any `app/api/cron/**/route.ts` handler, `lib/**`, migrations, `vercel.json` non-crons keys.

---

## Tests (`tests/unit/cron-schedule-contract.test.ts`)

Assert:

1. `vercel.json` `crons[].path` set equals approved list (9 paths post-02A with defer, or 7 after 02B).
2. Required core paths present.
3. Experimental paths **not** scheduled: `funnel-projection`, `truth-parity-repair`.
4. Duplicate cleanup paths **not** scheduled when covered: `idempotency-cleanup`, `oci/outbox-cleanup`, `processed-signals-retention`, `gdpr-retention`.
5. `invoice-freeze` allowed.
6. Comment: handlers may remain; only Vercel schedule surface reduced.

Optional strict list for **02A interim** (9 schedules): keep `retired-audit-cleanup (removed)` + `cleanup` in allowed set until 02B.

---

## Verification (CUT-02A PR)

```bash
npm run lint
npm run build
npm run audit:api-routes
npm run audit:knip
node --import tsx --test tests/unit/cron-schedule-contract.test.ts
npm run test:release-gates:pr
SMOKE_MODE=pr npm run smoke:api
```

No handler changes → smoke unchanged except deploy schedule behavior.

---

## Rollback

1. Revert `vercel.json` PR (single file rollback restores all schedules).
2. No DB rollback. No migrations. No route file rollback. No queue FSM rollback.

### Emergency manual invocation (break-glass)

```bash
# Requires CRON_SECRET or Vercel cron header
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://console.opsmantik.com/api/cron/<route>?apply=true"

# Night mutations also need:
# OPSMANTIK_STORAGE_CLEANUP_APPROVAL=I_APPROVE_STORAGE_MUTATION
```

Examples: `funnel-projection`, `truth-parity-repair`, `oci-recovery`, `retired-audit-cleanup (removed)`, `cleanup?dry_run=true`.

---

## Production Smoke (post-deploy)

| Check | Expected |
|---|---|
| `GET /api/health` | `git_sha` = merge commit |
| Sacred ingest/OCI | Not 410 `SURFACE_RETIRED` |
| CUT-01 retired surfaces | Still 410 |
| Core crons fire on schedule | Vercel cron logs show 200/207 for 7–9 paths |
| Watchtower | No alarm spike first hour |
| `oci-maintenance` heartbeat | PASS/PARTIAL in cron heartbeat table |

**410 observation (24–48h):** Watch removed paths in Vercel logs. Hourly `google-spend` N/A here; watch `funnel-projection`, `enqueue-from-sales`, `oci-recovery` for recurring callers.

---

## Explicit No-Touch List

- `/api/sync`, `/api/call-event`, `/api/call-event/v2`
- `/api/oci/google-ads-export`, `ack`, `ack-failed`, `script-heartbeat`, `v2/verify`
- `/api/intents/**`, `/api/calls/**`
- `public/assets/core.js`, `GoogleAdsScriptUniversal.js`
- `offline_conversion_queue`, `oci_queue_transitions` schema/FSM logic
- Migrations, Supabase RPCs, `conversation-service`, ingest processors
- Phone hash, consent, idempotency, HMAC paths

---

## Recommended Implementation Order

1. **Approve this plan** (confirm defer: `retired-audit-cleanup (removed)`, `cleanup`).
2. **CUT-02A:** vercel diet + `cron-schedule-contract.test.ts` + doc sync.
3. **Deploy + observe** 1 release (cron heartbeats, queue depth, storage audit).
4. **CUT-02B:** extend night-maintenance → unschedule last 2 duplicates.
5. **CUT-02C/D** as needed (ack TTL merge, break-glass runbook).

---

## CUT-02A implementation record

- **Removed from `vercel.json`:** 10 schedule rows (see REMOVED_IN_CUT_02A in `cron-schedule-contract.test.ts`).
- **Kept scheduled:** 9 (7 core/monthly + `retired-audit-cleanup (removed)` + `cleanup` deferred to 02B).
- **Target after 02B:** 7 scheduled crons when night-maintenance absorbs the two deferred jobs.
