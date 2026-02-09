# DR Plan — Backup + Restore Drill (OpsMantik)

## Goals

- Define **RPO/RTO** targets for OpsMantik.
- Define backup sources and retention expectations.
- Run a **quarterly restore drill** with documented proof.

Scope: production only.

## Targets

### RPO (Recovery Point Objective)

- **RPO target**: **≤ 24 hours**
- Meaning: in the worst case, we may lose up to 24h of data.

### RTO (Recovery Time Objective)

- **RTO target**: **≤ 4 hours**
- Meaning: time to restore service to a usable state (read dashboards + accept new ingestion).

## What must be recoverable

### Critical data (must restore)

- `sites`, `site_members`
- `sessions` (partitioned)
- `events` (partitioned)
- `calls`
- Secrets tables (private schema):
  - `private.site_secrets` (or equivalent)

### Critical capabilities (must work after restore)

- `/api/health` returns `ok: true` and `db_ok: true`
- `/api/sync` can enqueue work (or degrade loudly)
- `/api/sync/worker` can process messages (authorized)
- `/dashboard/site/<id>` loads for an authenticated user (if auth is configured for the restore environment)
- Partition drift guards are present (triggers/RPCs)

## Backup sources (where data comes from)

Primary source of truth is Supabase Postgres.

Recommended backup strategy depends on your Supabase plan/features:
- **Automated backups / PITR** (preferred when available)
- **Scheduled logical dumps** (fallback; e.g., `pg_dump` from a secure runner)
- **Schema/migrations** in git as the canonical schema evolution record

## Retention (recommended)

- **Daily backups**: retain **30 days**
- **Weekly backups**: retain **12 weeks**
- **Monthly backups**: retain **12 months**

If plan limitations prevent this, document the actual retention and adjust RPO accordingly.

## Restore drill cadence

- Run **quarterly** (every 3 months).
- Additionally run after:
  - major schema changes (partitioning, triggers, RLS)
  - any incident involving data corruption/deletes

## Restore drill method (preferred)

### Restore into a separate environment

Preferred: restore into a **separate Supabase project** (restore target) to avoid production risk.

Restore target requirements:
- no production traffic
- separate API keys
- controlled access
- same region if possible (latency realism)

## Validation (acceptance criteria)

The drill is successful only if all are true:

1. **Connectivity**
   - `GET /api/health` returns 200 with `db_ok: true`
2. **Partition drift guards**
   - `verify_partition_triggers_exist() = true`
3. **Data sanity**
   - row counts are plausible vs baseline snapshot
   - newest timestamps are plausible vs restore point
4. **App smoke**
   - at least one dashboard page loads (or login page loads without server errors)
5. **Time bounds**
   - Restore completes within RTO target (≤ 4h)
   - Restore point meets RPO target (≤ 24h data loss)

## Proof (required artifacts)

Attach to the DR ticket/run:
- timestamp of restore point and completion time (for RPO/RTO)
- baseline counts (before) + restored counts (after)
- `/api/health` output from restored environment
- SQL output proving triggers/RPCs
- notes on gaps found + follow-up tasks (owner + due date)

## Roles

- **DR lead**: coordinates the drill, records proof.
- **DB owner**: executes restore steps in Supabase.
- **App owner**: validates app-level smoke checks.

## References

- `docs/OPS/RUNBOOK_DB_RESTORE_DRILL.md` (detailed runbook)
- `scripts/ops/restore-drill.md` (human runnable steps + proof checklist)

