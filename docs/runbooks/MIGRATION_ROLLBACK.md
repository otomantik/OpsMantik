# Migration Rollback — Phase 19

**Rule:** Critical migrations (OCI, funnel, projection, billing) must have documented rollback steps.

---

## Critical Migrations (Export / Seal / Billing)

| Migration | Purpose | Rollback |
|-----------|---------|----------|
| `20261112000000_decrement_and_delete_idempotency_atomic` | Atomic compensation RPC | Do not drop; ingest worker depends on it. Rollback: revert worker to legacy `decrement_usage_compensation` + `deleteIdempotencyKeyForCompensation`; keep RPC for idempotency. |
| `20261105130000_oci_external_id_and_reversal_void` | Void cascade, external_id | Triggers: `trg_void_pending_oci_queue_on_call_reversal`, `trg_assign_offline_conversion_queue_external_id`. Rollback: disable triggers; re-enable prior logic if needed. |
| `20261103000000_bitemporal_marketing_signals` | Bitemporal valid_from/valid_to | Rollback: `trg_marketing_signals_bitemporal` disable; app must tolerate NULL valid_from/valid_to. |
| `20260625000000_precision_logic_session_created_month` | calls.session_created_month | Rollback: drop trigger; backfill NULL allowed. |
| `20260227141409_auto_increment_calls_version` | Optimistic locking | Rollback: drop trigger; seal route must not require version. |

---

## General Rollback Pattern

1. **Pre-rollback:** Snapshot DB state; verify no in-flight workers.
2. **Disable trigger/function:** `DROP TRIGGER ... ON table;` or `CREATE OR REPLACE FUNCTION ... RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$;` (no-op).
3. **Revert app code:** Deploy previous version that does not rely on migration.
4. **Down migration:** Optional; `supabase migration down` if available. Most migrations do not ship down scripts.
