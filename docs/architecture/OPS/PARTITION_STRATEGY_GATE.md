# PR-E1: Native partition gate (audit + legal)

**Do not implement native `sessions`/`events` partition DROP until:**

1. `scripts/db/storage-audit.mjs` shows `ingest_idempotency` or core tables above audit threshold (see `STORAGE_RETENTION_MATRIX.md`).
2. Legal/product sign-off on row delete vs anonymize for PII tables.
3. EXPLAIN evidence on retention RPCs shows acceptable plans.

Until then: use batch RPCs in `20261318120000_storage_retention_kernel_v1.sql` only.
