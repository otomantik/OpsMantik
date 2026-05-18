# Storage retention matrix (template)

**Decision label:** `STORAGE_RETENTION_KERNEL_AUDIT_FIRST_APPROVED`

Fill after `npm run db:storage-audit` and `scripts/sql/storage_audit.sql` in SQL Editor.

| Table / class | Retention | Mechanism | Batch limit | Dry-run default | Legal gate |
|---------------|-----------|-----------|-------------|-----------------|------------|
| `processed_signals` | 30–90d (TBD) | `delete_processed_signals_batch` | 5000 | yes | no |
| `ingest_idempotency` | 90d | `delete_expired_idempotency_batch` | 10000 | route dry_run | billing month guard |
| `outbox_events` PROCESSED | 7d | `delete_outbox_processed_batch` | 5000 | yes | no |
| `offline_conversion_queue` terminal | 90d | `cleanup_oci_queue_batch` | 500 (cascade transitions) | route | no |
| `oci_queue_transitions` | cascade with queue | — | — | — | no |
| `sessions` / `events` PII | 90d consent-less | `anonymize_consent_less_data_batch` | 5000 | yes | anonymize only |
| `sessions` / `events` row DELETE | TBD | **Not automated** | — | — | **legal required** |
| `calls` intent junk | product | `auto-junk` (`expires_at`) | 500 sites | no | no |
| `calls` stale recovery | fallback | `cleanup_auto_junk_stale_intents` | 5000 | `recovery_junk=1` only | no |
| `marketing_signals` SENT | 60d | `cleanup_marketing_signals_batch` | 5000 | yes | no |
| `truth_evidence_ledger` | 90–180d (TBD) | `delete_truth_evidence_batch` | 5000 | yes | flag gated |

## Audit thresholds (PR-E1 partition)

| Signal | Threshold | Action |
|--------|-----------|--------|
| `ingest_idempotency` rows | > 5–10M | PR-E1 partition plan |
| Table bytes | ops budget | review |

## Red lines

- No ad-hoc `DELETE FROM sessions/events WHERE ...`
- No ad-hoc `UPDATE offline_conversion_queue SET status = ...`
- Mutations require `OPSMANTIK_STORAGE_CLEANUP_APPROVAL=I_APPROVE_STORAGE_MUTATION` when `apply=true`
