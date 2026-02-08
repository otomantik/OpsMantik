# RUNBOOK — Partition Drift (sessions/events triggers missing)

## Scope

Production only. This runbook covers missing drift-guard triggers / partition key drift that can silently break ingestion joins and analytics.

Related:
- API check: `POST /api/watchtower/partition-drift` (authorized)
- RPC checks:
  - `watchtower_partition_drift_check_v1`
  - `verify_partition_triggers_exist`

## Symptoms

- CI DB verify fails (`verify_partition_triggers_exist`).
- `/api/watchtower/partition-drift` returns `{ ok: false }`.
- Sessions/events ingestion appears “partial” (writes exist but joins/analytics break).
- Errors mentioning missing triggers/functions/partition keys.

## Immediate checks (5 minutes)

1. **Call partition drift endpoint (prod)**

Requires `WATCHTOWER_SECRET`:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $WATCHTOWER_SECRET" \
  https://console.opsmantik.com/api/watchtower/partition-drift | jq .
```

Expected:
- `{ ok: true, ... }`

2. **Verify triggers via script (from your machine)**

Requires prod Supabase URL + service role key in env:

```bash
node scripts/verify-partition-triggers.mjs
```

Expected:
- `Partition triggers OK (sessions_set_created_month, events_set_session_month_from_session)`

## Commands to run (Supabase SQL Editor)

### A) Confirm trigger existence (manual)

```sql
SELECT tgname, tgenabled, pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND c.relname IN ('sessions','events')
ORDER BY c.relname, tgname;
```

Expected:
- A trigger on `sessions` that sets `created_month`
- A trigger on `events` that sets `session_month` from the referenced session

## Mitigation

### 1) Re-apply migrations / drift-guard SQL
- Deploy the latest Supabase migrations (or re-run the migration that creates drift triggers).
- Ensure `verify_partition_triggers_exist` returns true.

### 2) Emergency: restore triggers (only if you have the canonical SQL)
- Apply the exact trigger/function definitions from the repo migration history.
- Do **not** improvise trigger logic in production without review.

### 3) Validate partition creation
- Ensure next-month partitions exist (sessions/events) if your system relies on them.
- If partitions missing, create them via your standard partition maintenance routine.

## Rollback

- If a migration caused the drift, roll back to previous DB state only if you have a safe rollback plan.
- Otherwise, forward-fix by restoring the canonical triggers.

## Proof / Acceptance checklist

- [ ] `/api/watchtower/partition-drift` returns `ok: true`.
- [ ] `node scripts/verify-partition-triggers.mjs` exits 0.
- [ ] New sessions/events created in prod have correct partition key fields set (`created_month` / `session_month`).
- [ ] Dashboard analytics/joins behave normally for new traffic.

