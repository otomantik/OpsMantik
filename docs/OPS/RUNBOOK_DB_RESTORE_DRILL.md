# RUNBOOK — DB Restore Drill (Quarterly)

## Scope

Production-only drill. Goal is to prove we can restore and validate data integrity within target time (RTO) and data loss window (RPO).

**Important:** Do not perform destructive operations on the live production database without explicit approval and a maintenance window.

## Symptoms / Triggers for running the drill

- Scheduled quarterly DR exercise
- After major schema changes (partitioning, triggers, RLS policy changes)
- After an incident involving data corruption or accidental deletes

## Preconditions

- Access to Supabase project backups / PITR (plan-dependent)
- A safe target to restore into (preferred):
  - a separate Supabase project (“restore target”), OR
  - a new database instance not used by production traffic
- List of critical tables and smoke queries ready

## Immediate checks (before restore)

1. Capture current production metadata (proof baseline)

```bash
curl -sS https://console.opsmantik.com/api/health | jq .
```

Record:
- `ts`
- `git_sha` (if present)
- `db_ok`

2. Capture row counts (baseline snapshot)

Supabase SQL Editor (prod):

```sql
SELECT
  (SELECT COUNT(*) FROM public.sites)    AS sites,
  (SELECT COUNT(*) FROM public.sessions) AS sessions,
  (SELECT COUNT(*) FROM public.events)   AS events,
  (SELECT COUNT(*) FROM public.calls)    AS calls;
```

Expected: non-zero counts (except in very early environments).

## Restore procedure (high-level)

### Option A (preferred): Restore into a separate project/DB

1. Create/choose a restore target environment (no production traffic).
2. Restore from the latest production backup (or chosen point-in-time).
3. Apply application env to point to restore target (never prod keys).

### Option B (if you must restore in-place): PITR / Backup restore

Only during a maintenance window. Follow Supabase official restore procedure.

## Post-restore validation (must pass)

### A) Connectivity + health

```bash
curl -sS <RESTORED_BASE_URL>/api/health | jq .
```

Expected:
- `ok: true`
- `db_ok: true`

### B) Schema checks

Run these SQL queries on the restored DB:

**Partition drift triggers present:**

```sql
SELECT public.verify_partition_triggers_exist() AS triggers_ok;
```

Expected: `true`

**RPC exists:**

```sql
SELECT public.ping() AS ping_ok;
```

Expected: `true` or a non-error response.

### C) Data sanity checks

```sql
-- Freshness (recent data exists)
SELECT MAX(created_at) AS last_session_at FROM public.sessions;
SELECT MAX(created_at) AS last_call_at    FROM public.calls;

-- Referential sanity (calls to sessions may be null; but should not explode)
SELECT COUNT(*) AS calls_with_session
FROM public.calls
WHERE matched_session_id IS NOT NULL;
```

Expected:
- `last_session_at` and `last_call_at` are plausible
- Queries execute without errors/timeouts

### D) Application-level smoke checks

From restored environment:
- Load `/dashboard` and one `/dashboard/site/<id>` (if auth is configured for the restore target).
- Call Watchtower endpoints (authorized) if configured.

## Mitigation if validation fails

- Missing triggers/RPCs: apply migrations in the restore target until checks pass.
- Data missing: choose a different restore point (PITR earlier) and repeat.
- RLS/auth issues: validate environment variables and Supabase auth configuration for the restore target.

## Rollback (drill cleanup)

- Tear down restore target or revoke credentials.
- Ensure no production secrets were copied into the restore environment.

## Proof checklist (what you must capture)

- [ ] Screenshot/log: restore completed successfully (Supabase backup/PITR UI evidence)
- [ ] Output: `/api/health` from restored environment (`ok` + `db_ok`)
- [ ] Output: `verify_partition_triggers_exist() = true`
- [ ] Output: baseline row counts vs restored row counts (within expected delta)
- [ ] Notes: restore point timestamp, duration (RTO), and data loss window (RPO estimate)
- [ ] Follow-ups: any gaps found + owners + due dates

