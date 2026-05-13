# OCI Queue Lifecycle Contract (`offline_conversion_queue`)

**PR-1 scope:** This document is the SSOT for **operational** queue state semantics, allowed transitions, lineage, and approved writers. It does not change conversion math, export payloads, or Google Apps Script behavior.

**Related:** [OCI_QUEUE_HEALTH.md](./OCI_QUEUE_HEALTH.md) (score 100 / evidence), [EXPORT_CLOSURE.md](./EXPORT_CLOSURE.md) (journal-only export), [OCI_QUEUE_HEALTH_SOURCES.md](./OCI_QUEUE_HEALTH_SOURCES.md).

---

## 1. Schema status vocabulary (authoritative)

These values are valid on `offline_conversion_queue.status` per DB `offline_conversion_queue_status_check` and TypeScript `QUEUE_STATUSES` in [`lib/domain/oci/queue-types.ts`](../../lib/domain/oci/queue-types.ts).

| Status | Classification |
|--------|----------------|
| `QUEUED` | Active (export-eligible when other fields OK) |
| `RETRY` | Active (export-eligible after `next_retry_at`) |
| `PROCESSING` | In-flight (claimed for script/API upload) |
| `UPLOADED` | **Dispatch-pending / intermediate** — script or API path handed off to Google; **not** the same as “Google has finished importing” (`pendingConfirmation` / bulk-upload semantics on ACK). See §5.1. |
| `COMPLETED` | **Terminal (pipeline closed)** — ACK-success under the export/claim contract; **does not by itself assert** Google Ads backend import proof. See §5.1. |
| `COMPLETED_UNVERIFIED` | **Terminal (unverified closure)** — e.g. cron sweep from long-lived `UPLOADED` without full provider verification; must stay visually and semantically distinct. See §5.1. |
| `FAILED` | **Terminal** — retriable in product via control-plane / repair |
| `DEAD_LETTER_QUARANTINE` | **Terminal** — attempt-cap / fatal poison; audit via dead-letter tools |
| `VOIDED_BY_REVERSAL` | **Terminal** — business reversal |
| `BLOCKED_PRECEDING_SIGNALS` | **Strict-outside narrow FSM** — ordering gate before `QUEUED`; promoted when precursors clear |

`DEAD_LETTER_QUARANTINE` **is** present in schema and contracts — not a hypothetical status.

---

## 2. Target strict lifecycle (export + ACK lane)

Operasyonel “mutlu yol” script export için:

```
QUEUED ──claim──▶ PROCESSING ──ACK success (not pendingConfirmation)──▶ COMPLETED
   ▲                  │
   │                  ├──ACK pendingConfirmation──▶ UPLOADED ──ACK──▶ COMPLETED
   │                  │
   └──── recover / retry RPCs / ACK_FAILED TRANSIENT ──┘
```

- **RETRY → PROCESSING:** same as QUEUED for claim (`append_script_claim_transition_batch` in export).
- **PROCESSING → RETRY:** `ACK_FAILED` with `errorCategory: TRANSIENT` (and attempts &lt; cap).
- **PROCESSING → FAILED:** `ACK_FAILED` non-transient, granular `FAILED` in ACK, deterministic skip after claim, etc.
- **FAILED → RETRY / QUEUED:** operator `update_queue_status_locked` and maintenance paths (must respect DB FSM — see §7).
- **FAILED → DEAD_LETTER_QUARANTINE:** attempt cap or fatal `fatalIds` on ACK_FAILED.

---

## 3. Allowed transitions (normative examples)

| From | To | Typical actor / mechanism |
|------|-----|---------------------------|
| `QUEUED` | `PROCESSING` | Script export: `append_script_claim_transition_batch` |
| `RETRY` | `PROCESSING` | Same claim RPC when row is eligible |
| `PROCESSING` | `UPLOADED` | `/api/oci/ack` + `pendingConfirmation: true` → `append_script_transition_batch` |
| `PROCESSING` | `COMPLETED` | `/api/oci/ack` success → `append_script_transition_batch` |
| `PROCESSING` | `RETRY` | `/api/oci/ack-failed` TRANSIENT → `append_script_transition_batch` |
| `PROCESSING` | `FAILED` | `/api/oci/ack-failed`, ACK granular failure, post-export sendability guard, export finalization (incl. `SUPPRESSED_BY_HIGHER_GEAR`) |
| `PROCESSING` | `DEAD_LETTER_QUARANTINE` | ACK_FAILED max attempts or fatal seal IDs |
| `FAILED` | `RETRY` / `QUEUED` | Control plane RPC `update_queue_status_locked` (where FSM allows) |
| `BLOCKED_PRECEDING_SIGNALS` | `QUEUED` | `append_worker_transition_batch_v2` in [`lib/oci/promote-blocked-queue.ts`](../../lib/oci/promote-blocked-queue.ts) |
| Stuck `PROCESSING` | `QUEUED` / repair | `recover_stuck_offline_conversion_jobs` (cron / maintenance) |

---

## 4. Forbidden transitions (must not happen in healthy operation)

Examples enforced by **policy** and **partially** by DB trigger (§7):

| Transition | Why |
|------------|-----|
| `COMPLETED` → `QUEUED` / `RETRY` | Terminal success must not “rewind” without formal repair (DB FSM blocks some rewind) |
| `COMPLETED` → `FAILED` | Same |
| `FAILED` → `COMPLETED` | No silent upgrade without new upload + ledger |
| `QUEUED` / `RETRY` → `COMPLETED` without `PROCESSING` + ACK family | Skips claim / lineage |
| Arbitrary direct `.update({ status })` from app servers | Bypasses `oci_queue_transitions` ledger + snapshot apply |

---

## 5. `COMPLETED` / `UPLOADED` / `COMPLETED_UNVERIFIED` semantics (pipeline vs provider proof)

**Strict rule (pipeline):** `COMPLETED` and `UPLOADED` describe **OpsMantik ledger / ACK closure** under the export-claim contract — **not** a standalone guarantee that Google Ads has fully imported the conversion in their backend.

- **`/api/oci/ack`** success (`COMPLETED` or `UPLOADED` → later `COMPLETED`), including idempotent replays via `register_ack_receipt_v1` / `complete_ack_receipt_v1` (**site-scoped:** completion RPC matches `receipt_id` **and** `site_id` on `ack_receipt_ledger`).
- **`skippedIds` on ACK** (`V1_SAMPLED_OUT`, etc.) — still ACK-shaped (`/api/oci/ack`), not export-batch self-completion.

**Not a Google completion (must not use `COMPLETED`):**

- **Higher-gear suppression:** Rows dropped from the export batch because a higher single-conversion gear already won the group are terminalized as **`FAILED`** with `provider_error_code=SUPPRESSED_BY_HIGHER_GEAR` and `provider_error_category=DETERMINISTIC_SKIP` in [`export-mark-processing.ts`](../../app/api/oci/google-ads-export/export-mark-processing.ts). Nothing was uploaded for those order IDs; they are **not** successful Google conversions and must not be counted as such in lifecycle or reporting.

**`UPLOADED`:** Intermediate when `pendingConfirmation=true` / `providerConfirmationMode=bulk_upload_async_unconfirmed` — **dispatch succeeded**, Google import still pending / unobservable from Scripts.

**`COMPLETED_UNVERIFIED`:** Terminal closure without full provider verification (e.g. [`app/api/cron/oci/sweep-zombies/route.ts`](../../app/api/cron/oci/sweep-zombies/route.ts) aging `UPLOADED` → `COMPLETED_UNVERIFIED`). Operators and dashboards must **not** treat this as “Google-confirmed revenue.”

**Queue Health 100 (PR-1C):** Legacy **`failed_rate` / `total_failed_rate`** still reflect total **FAILED + DLQ mass** (deterministic skips remain observable). **Gates and score 100** use **`actionable_failed_rate`** and **`provider_failed_rate`** from [`lib/oci/queue-failure-taxonomy.ts`](../../lib/oci/queue-failure-taxonomy.ts) / [`queue_health.sql`](../../scripts/sql/queue_health.sql) — deterministic skips are **excluded** from those numerators so they do not inflate “provider broken” narratives. There is no separate “successful Google upload” counter in v1 health — do not treat `FAILED` rows with `SUPPRESSED_BY_HIGHER_GEAR` as `COMPLETED` in ops narrative.

### §5.1 OCI Truth — product language (regression bar)

Any UX, doc, or metric that presents **script dispatch**, **`upload.apply()` success**, **ACK-success**, or **pipeline closure** as **“Google definitely imported / accepted the conversion”** without **separate provider proof** is a **regression** against Revenue Truth. UI copy for `UPLOADED`, `COMPLETED`, and `COMPLETED_UNVERIFIED` must keep this distinction (see OCI Control tooltips + i18n).

---

## 6. Lineage & audit fields

- **Immutable ledger:** `oci_queue_transitions` (+ actor `SCRIPT` | `WORKER` | …).
- **Snapshot apply:** `apply_snapshot_batch` keeps `offline_conversion_queue` consistent with latest ledger row.
- **Runtime rule:** Mutations that change `status` or error/retry fields should go through **`append_script_transition_batch`**, **`append_script_claim_transition_batch`**, **`append_worker_transition_batch_v2`**, or approved maintenance RPCs — not ad-hoc SQL.

---

## 7. Database FSM guard

Trigger `tr_oci_status_fsm` / `enforce_oci_status_fsm()` enforces an **explicit allow-list** of legal `(OLD.status → NEW.status)` transitions (see migration `supabase/migrations/20261231000000_defcon1_absolute_fsm_dictatorship.sql`), including the **PR-9K** session gate (`opsmantik.pr9k_operator_requeue`) for operator requeue from `COMPLETED` / `UPLOADED` to `RETRY` | `QUEUED`. Any transition outside the matrix raises `DEFCON_1_ILLEGAL_STATE_TRANSITION`.

---

## 8. Row deletion / GDPR

- **Operational SRE default:** Do not DELETE queue rows for pipeline repair; prefer terminalization and evidence — see [OCI_HARDENING_OPERATIONS.md](../runbooks/OCI_HARDENING_OPERATIONS.md).
- **Exception:** Scheduled GDPR / retention flows (e.g. `/api/gdpr/erase`, cleanup cron) may delete or archive per policy — **not** part of day-to-day export closure.

---

## 9. Approved transition writers (audit matrix)

| File | Transition / write | Approved? | Classification | Notes |
|------|-------------------|-----------|----------------|-------|
| [`export-mark-processing.ts`](../../app/api/oci/google-ads-export/export-mark-processing.ts) | claim + `PROCESSING`; deterministic paths → `FAILED` (incl. suppression); only kept rows stay `PROCESSING` for ACK | Yes | `APPROVED_TRANSITION_RPC` | `COMPLETED` only via ACK, not for suppression |
| [`app/api/oci/ack/route.ts`](../../app/api/oci/ack/route.ts) | `PROCESSING` → `COMPLETED` / `UPLOADED` / `FAILED` | Yes | `APPROVED_TRANSITION_RPC` | + ACK receipt replay |
| [`app/api/oci/ack-failed/route.ts`](../../app/api/oci/ack-failed/route.ts) | `PROCESSING` → `RETRY` / `FAILED` / `DEAD_LETTER_QUARANTINE` | Yes | `APPROVED_TRANSITION_RPC` | TRANSIENT vs permanent |
| [`lib/oci/promote-blocked-queue.ts`](../../lib/oci/promote-blocked-queue.ts) | `BLOCKED_PRECEDING_SIGNALS` → `QUEUED` | Yes | `APPROVED_TRANSITION_HELPER` | `append_worker_transition_batch_v2` |
| [`lib/oci/invalidate-pending-artifacts.ts`](../../lib/oci/invalidate-pending-artifacts.ts) | Active → `FAILED` on junk reversal | Yes | `APPROVED_TRANSITION_HELPER` | **PR-1:** migrated off direct `.update` to `append_worker_transition_batch_v2` |
| [`lib/oci/process-single-oci-export.ts`](../../lib/oci/process-single-oci-export.ts) | API-mode worker claims | Yes | `APPROVED_TRANSITION_RPC` | Worker batch v2 |
| [`lib/oci/runner/queue-bulk-update.ts`](../../lib/oci/runner/queue-bulk-update.ts) | Worker bulk | Yes | `APPROVED_TRANSITION_RPC` | Worker batch v2 |
| [`app/api/oci/queue-actions/route.ts`](../../app/api/oci/queue-actions/route.ts) | Operator RETRY / reset / fail | Yes | `APPROVED_TRANSITION_RPC` | `update_queue_status_locked` |
| Cron / maintenance | Stuck recovery | Yes | `APPROVED_TRANSITION_RPC` | `recover_stuck_offline_conversion_jobs` |
| [`scripts/db/oci-recalculate-values-stage-base.ts`](../../scripts/db/oci-recalculate-values-stage-base.ts) | Value / metadata patch only | Yes* | `LEGACY_COMPATIBILITY` | Ops script; **does not** change `status` |
| `app/**`, `lib/**` (other) | `offline_conversion_queue` | — | `READ_ONLY` / none | Select-only |

\* Run only with ops approval; not an application runtime path.

---

## PR-1B — Suppression / superseded artifacts (audit matrix)

Single-conversion mode drops lower-gear queue rows from the **export batch** when a higher gear wins the same group. Those rows must **not** appear as Google upload successes.

| File | Current behavior | Writes `COMPLETED`? | Google ACK? | Strict lifecycle | Action (PR-1B) |
|------|------------------|---------------------|-------------|------------------|----------------|
| [`export-mark-processing.ts`](../../app/api/oci/google-ads-export/export-mark-processing.ts) | Claim + `append_script_transition_batch` → **`FAILED`** for `suppressedQueueIds` via `claimAndFinalizeQueue` | **No** | **No** | `FAILED` + `DETERMINISTIC_SKIP` / `SUPPRESSED_BY_HIGHER_GEAR` | Aligned |
| [`export-build-items.ts`](../../app/api/oci/google-ads-export/export-build-items.ts) | Builds `suppressedQueueIds` / `keptConversions` (no DB writes) | — | — | READ_ONLY / planning | — |
| [`google-ads-export/route.ts`](../../app/api/oci/google-ads-export/route.ts), [`export-response.ts`](../../app/api/oci/google-ads-export/export-response.ts) | `counts.suppressed` telemetry | — | — | Observability | — |
| [`lib/oci/invalidate-pending-artifacts.ts`](../../lib/oci/invalidate-pending-artifacts.ts) | Panel junk reversal → `FAILED` (worker RPC) | No | No | `FAILED` | — |
| [`lib/oci/outbox/process-outbox.ts`](../../lib/oci/outbox/process-outbox.ts) | Skips enqueueing lower gears when higher exists | — | — | Upstream prevent | — |

`append_worker_transition_batch_v2`: not used on this path (script-owned **`append_script_*`** RPCs only).

---

## 10. ACK / ACK_FAILED deterministic replay

- Both routes call **`registerAckReceipt`** / **`completeAckReceipt`** with a stable payload hash (see [`lib/oci/ack-receipt.ts`](../../lib/oci/ack-receipt.ts)).
- Replay with same hash must return the stored `resultSnapshot` and **must not** double-apply transitions (DB + receipt guard).

---

## 11. Follow-ups

| ID | Item |
|----|------|
| P1 | (Resolved PR-1B) ~~`SUPPRESSED_BY_HIGHER_GEAR` → `COMPLETED`~~ — now `FAILED` + `DETERMINISTIC_SKIP`. |
| P2 | ~~Expand DB FSM to full §3–4 matrix~~ — superseded by `20261231000000_defcon1_absolute_fsm_dictatorship.sql` (allow-list + PR-9K gate). |

---

## 12. PR-1 verification

- Unit: `tests/unit/oci-queue-lifecycle-contract.test.ts` pins this document’s matrices and key implementation anchors.
- Release: `npm run test:release-gates` before deploy (workspace rule).
