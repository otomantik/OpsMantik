# ingest_idempotency Cleanup Job (Non–Invoice-Critical)

**Purpose:** Remove rows with `expires_at < NOW()` to control table size. Not required for invoice correctness; invoice count uses rows within billing month only.

**Policy:** Retention >= 90 days (Revenue Kernel spec). Application sets `expires_at = created_at + 90 days`.

**SQL (run periodically, e.g. daily cron):**

```sql
DELETE FROM public.ingest_idempotency
WHERE expires_at < NOW();
```

**Index:** `idx_ingest_idempotency_expires_at` supports this query.

**Note:** Do not run cleanup for dates within current or previous 2 billing months if you need dispute evidence; 90-day retention already covers that.
