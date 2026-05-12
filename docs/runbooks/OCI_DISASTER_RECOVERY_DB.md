# OCI — database disaster recovery (L20 stub)

**Scope:** Wrong bulk backfill, migration mistake, or regional DB incident affecting OCI tables (`offline_conversion_queue`, `outbox_events`, `oci_reconciliation_events`, journals).

## Principles

1. **Migrations are SSOT** — follow repo migration policy; do not “fix prod” with ad-hoc schema drift.
2. **PITR / branch restore** — Supabase (or host) point-in-time recovery is the primary **rollback of data** when a bad deploy or script touched many rows.
3. **OCI-specific** — after restore, re-run **release gates** and **verify-db** against the restored target; replay blocked exports only via approved runbooks (no direct queue `.update` in production).

## When to open an incident

- Sudden spike in `FAILED` / `PROCESSING` zombies with correlated migration timestamp.
- Evidence job shows partition or FSM drift after a migration.

## Next steps (operational, not automated here)

- Document exact **Supabase project** PITR window and **branch** workflow in your org’s central DR runbook.
- Link this page from [`OCI_SSOT_TROUBLESHOOTING.md`](./OCI_SSOT_TROUBLESHOOTING.md) incident tree when root cause is data-wide.
