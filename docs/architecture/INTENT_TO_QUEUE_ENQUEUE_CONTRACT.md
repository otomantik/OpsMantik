# Intent-to-Queue Enqueue Contract

## 1. Single Truth Upload Journal
`offline_conversion_queue` is the ONLY runtime Google upload journal. 
The legacy `offline_conversion_queue` table is an **ACTIVE_RUNTIME_RESIDUE**. It still receives writes for non-won stages, but it is NOT the Google upload authority. It must be treated as an audit-only shadow trail. The upload backlog is exclusively defined by `offline_conversion_queue` where `status IN ('QUEUED', 'RETRY')`.

## 2. Four-Stage Alignment
All four Google-bound fired stages must be queue-journaled when triggered:
- `OpsMantik_Contacted`
- `OpsMantik_Offered`
- `OpsMantik_Won`
- `OpsMantik_Junk_Exclusion`

These must route through `enqueueOciConversionRow` or `enqueueSealConversion` into the queue.

## 3. No Silent Fired-Stage Skips
If a stage fires, it MUST NOT silently vanish. If a precondition fails (e.g. missing consent, missing click ID), a structured row must be inserted into the queue to provide an audit trail. Early returns that drop the DB insert are forbidden.

### Structured Blocked Outcome Mapping
We utilize existing `status` and taxonomy columns to avoid status-enum explosion:

| Condition | Status | Category (`provider_error_category`) | Reason/Code (`provider_error_code` / `block_reason`) | Exportable? |
|---|---|---|---|---|
| `MISSING_CLICK_ID` | `BLOCKED_PRECEDING_SIGNALS` | `null` | `block_reason = 'MISSING_CLICK_ID'` | No |
| `CONSENT_MISSING` | `FAILED` | `DETERMINISTIC_SKIP` | `provider_error_code = 'CONSENT_MISSING'` | No |
| `NOT_EXPORT_ELIGIBLE` | `FAILED` | `DETERMINISTIC_SKIP` | `provider_error_code = 'NOT_EXPORT_ELIGIBLE'` | No |
| `INVALID_VALUE_POLICY`| `FAILED` | `VALIDATION` | `provider_error_code = 'INVALID_VALUE_POLICY'` | No |
| `SCHEMA_UNSUPPORTED`  | `FAILED` | `VALIDATION` | `provider_error_code = 'SCHEMA_UNSUPPORTED'` | No |

Rows mapping to `FAILED` + `DETERMINISTIC_SKIP` are explicitly excluded from `actionable_failed_rate` in the queue health pack (`scripts/sql/queue_health.sql`), ensuring they do not trigger false-positive alerts while remaining fully visible.

## 4. Immutable History
Queue rows are never deleted to fix errors. They progress through the status machine. Errors must be transitioned to terminal states (`FAILED`, `VOIDED_BY_REVERSAL`, etc.).

## 5. Won Pipeline Orphan Repair Contract (PR-7C)
- `wonMissingPipeline > 0` means at least one won/sealed call has no queue journal coverage and is a promotion blocker in strict readiness.
- Repair must start with dry-run evidence (`scripts/sql/orphan_won_backfill.sql`).
- Write mode must be site-scoped and operator-approved (change ticket + operator ID + explicit confirmation).
- Write path must use canonical enqueue logic (`enqueueSealConversion`), preserving deterministic `external_id` / value SSOT and idempotency behavior.
- Forbidden during repair: queue deletion, direct SQL value math writes, ad-hoc COMPLETED marking.
