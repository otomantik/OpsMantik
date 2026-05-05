# Supabase Migration Drift Policy

This project applies schema changes via Cursor Supabase MCP, not CLI `db push`.

## Why this exists

In this repo, some local migration files use `202612...` versions, while remote history may contain equivalent migrations applied earlier with `20260504...` versions and `_equivalent_check` naming.

Runtime can still be healthy (objects exist), but version/name drift can confuse operators and future deploy checks.

## Known equivalent version map

| Local file | Remote-equivalent migration name |
|------------|----------------------------------|
| `20261223030000_ack_receipt_stale_registered_sweep_index.sql` | `ack_receipt_stale_registered_sweep_index_20261223` |
| `20261224000000_intent_coalesce_window_professional_v1.sql` | `intent_coalesce_window_professional_v1_20261224` |
| `20261225000000_intent_coalesce_window_tighten_v1.sql` | `intent_coalesce_window_tighten_v1_20261225` |
| `20261226000000_oci_transition_grants_revoke_apply_call_action_strict.sql` | `oci_transition_grants_revoke_apply_call_action_strict` |

## Operational rule

Do **not** re-apply equivalent migrations just to force version-number parity.

Instead:
1. Verify runtime objects/indexes/grants directly with MCP `execute_sql`.
2. Keep this mapping up to date when equivalent migrations are intentionally applied under different version prefixes.
3. If production parity tooling requires exact version sync, run a dedicated migration-history repair change with explicit review (separate task).

## Minimum MCP proof commands

- `list_migrations` (presence of equivalent names)
- `execute_sql` for:
  - `idx_outbox_events_pending_site_call_stage_uq` existence
  - grant posture on `oci_queue_transitions` / `oci_payload_validation_events`
  - EXECUTE grants for transition RPCs limited to `service_role` (plus owner role)
