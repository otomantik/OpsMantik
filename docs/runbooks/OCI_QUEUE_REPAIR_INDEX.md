# OCI queue repair index (read this before any SQL)

**OCI Truth:** Mutating `offline_conversion_queue.status` with ad-hoc `UPDATE` bypasses `oci_queue_transitions` and the DB FSM — **do not** do it in production troubleshooting.

## Approved first steps

1. **Stuck `PROCESSING` (worker/API path):** `POST /api/cron/providers/recover-processing` — see [`PROVIDERS_UPLOAD_RUNBOOK.md`](./PROVIDERS_UPLOAD_RUNBOOK.md) (Recovery / Rollback sections).
2. **Script export / ACK hygiene:** [`OCI_HARDENING_OPERATIONS.md`](./OCI_HARDENING_OPERATIONS.md) — PR-9K selector/requeue scripts are **dry-run by default** (`scripts/db/pr9k-select-unconfirmed-script-completed-rows.mjs`, `scripts/db/pr9k-requeue-unconfirmed-script-completed-rows.mjs`). **Never** set `APPLY=1` without an explicit incident approval process.
3. **Lifecycle SSOT:** [`../architecture/OCI_QUEUE_LIFECYCLE_CONTRACT.md`](../architecture/OCI_QUEUE_LIFECYCLE_CONTRACT.md) — distinguishes pipeline ACK closure vs provider import proof.

## Legacy SQL under `docs/runbooks/oci_*.sql`

These files are **read-only forensic** helpers (mostly `SELECT`). Any historical **`UPDATE offline_conversion_queue`** recipe must stay **fully commented** in git so operators cannot accidentally paste-live a ledger bypass. Prefer cron + RPC repair paths above. For incident response, copy from comments only under explicit change control — see [`OCI_HARDENING_OPERATIONS.md`](./OCI_HARDENING_OPERATIONS.md).
