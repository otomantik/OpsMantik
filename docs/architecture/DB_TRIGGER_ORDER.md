# DB Trigger Order and Audit

**Phase 17:** Document trigger firing order; avoid hidden cascades that diverge from app expectations.

---

## Critical Triggers (OCI / Funnel / Revenue)

| Table | Trigger | Event | Purpose |
|-------|---------|-------|---------|
| calls | trg_void_pending_oci_queue_on_call_reversal | UPDATE | VOIDs QUEUED/RETRY when call junked/cancelled/restored |
| calls | trg_assign_offline_conversion_queue_external_id | INSERT/UPDATE | Assigns external_id to queue rows |
| marketing_signals | enforce_append_only_signals | INSERT/UPDATE/DELETE | Prevents non-append operations |
| marketing_signals | trg_marketing_signals_bitemporal | INSERT/UPDATE | Sets valid_from/valid_to |
| marketing_signals | trg_marketing_signals_state_machine | UPDATE | Enforces dispatch_status transitions |
| offline_conversion_queue | trg_offline_conversion_queue_state_machine | UPDATE | Enforces state transitions |
| sessions | sessions_set_created_month | INSERT/UPDATE | Sets created_month for partitioning |
| events | events_set_session_month_from_session | INSERT | Cascade session_month from session |
| calls | calls_enforce_session_created_month | INSERT | Orphan prevention: session created_month must match |
| calls | trg_calls_version_increment | UPDATE | Optimistic locking version |

## Ordering Rules

- **trg_void_pending_oci_queue_on_call_reversal** must fire **after** calls.status change; voided rows excluded from export.
- **enforce_append_only_signals** runs before app logic; rejects DELETE and non-append UPDATEs.
- **sessions_set_created_month** → **events_set_session_month_from_session**: session insert triggers session_month; events derive from session.

## Full Catalog

See `supabase/migrations/` for definitions. Key migrations:

- `20261105130000_oci_external_id_and_reversal_void.sql` — void cascade, external_id
- `20261103000000_bitemporal_marketing_signals.sql` — bitemporal
- `20260305000004_strict_state_machine.sql` — state machines
- `20260329000004_marketing_signals_stream.sql` — enforce_append_only
- `20260201210000_comprehensive_partition_cleanup_and_fix.sql` — partition triggers
