# Restore Drill Script (Human-run) — OpsMantik

This is a **procedure** (not an automated script) intended to be run by a human during a quarterly DR restore drill.

## Safety

- Prefer restoring into a **separate Supabase project** (restore target).
- Do **not** run destructive actions on production without explicit approval + maintenance window.

## Inputs (fill these)

- **PROD_BASE_URL**: `https://console.opsmantik.com`
- **RESTORE_BASE_URL**: `<your restored env base url>`
- **RESTORE_POINT**: `<timestamp / backup id>`
- **DR_TICKET**: `<link/id>`

For local scripts (optional):
- `NEXT_PUBLIC_SUPABASE_URL` (restore target)
- `SUPABASE_SERVICE_ROLE_KEY` (restore target)

## Step 0 — Baseline proof (production)

### 0.1 Health

```bash
curl -sS "$PROD_BASE_URL/api/health" | jq .
```

Expected:
- `ok: true`
- `db_ok: true` (best-effort)

Save output to the DR ticket as **baseline**.

### 0.2 Baseline row counts (prod)

Supabase SQL Editor (prod):

```sql
SELECT
  (SELECT COUNT(*) FROM public.sites)    AS sites,
  (SELECT COUNT(*) FROM public.sessions) AS sessions,
  (SELECT COUNT(*) FROM public.events)   AS events,
  (SELECT COUNT(*) FROM public.calls)    AS calls;
```

Save output to the DR ticket.

## Step 1 — Restore (DB owner)

Restore PROD database into the restore target using the chosen method:
- Automated backup restore / PITR (preferred when available)
- Logical dump restore (fallback)

Record:
- start time
- finish time
- restore point timestamp

## Step 2 — Post-restore validation (restore target)

### 2.1 Health endpoint

```bash
curl -sS "$RESTORE_BASE_URL/api/health" | jq .
```

Expected:
- `ok: true`
- `db_ok: true`

### 2.2 Trigger / partition drift guard

If you have restore target env vars set locally:

```bash
node scripts/verify-partition-triggers.mjs
```

Expected:
- `Partition triggers OK ...`

If not, run in restore target SQL Editor:

```sql
SELECT public.verify_partition_triggers_exist() AS triggers_ok;
```

Expected:
- `true`

### 2.3 Data sanity checks (restore target)

```sql
SELECT MAX(created_at) AS last_session_at FROM public.sessions;
SELECT MAX(created_at) AS last_call_at    FROM public.calls;
```

Expected:
- timestamps are plausible for the restore point

Row counts (restore target):

```sql
SELECT
  (SELECT COUNT(*) FROM public.sites)    AS sites,
  (SELECT COUNT(*) FROM public.sessions) AS sessions,
  (SELECT COUNT(*) FROM public.events)   AS events,
  (SELECT COUNT(*) FROM public.calls)    AS calls;
```

Expected:
- close to baseline counts (difference depends on restore point)

### 2.4 App smoke (restore target)

Open:
- `$RESTORE_BASE_URL/api/health`
- `$RESTORE_BASE_URL/dashboard`
- `$RESTORE_BASE_URL/dashboard/site/<some-site-uuid>` (if auth is configured)

Expected:
- no server-side 500s
- login may appear (acceptable), but must not crash

## Step 3 — Acceptance criteria

Mark drill as **PASS** only if:
- [ ] RPO ≤ 24h (restore point is within 24h)
- [ ] RTO ≤ 4h (end-to-end restore + validation)
- [ ] `/api/health` returns ok + db_ok on restore target
- [ ] partition triggers verified ok
- [ ] data sanity queries succeed

If any fail: mark **FAIL**, capture evidence, and create follow-up tasks.

## Step 4 — Proof package (attach to DR ticket)

- [ ] Restore point id/timestamp + start/end time
- [ ] Production baseline `/api/health` output
- [ ] Production baseline row counts
- [ ] Restore target `/api/health` output
- [ ] Restore target row counts
- [ ] `verify_partition_triggers_exist = true` proof
- [ ] Notes on gaps + owners + deadlines

## Step 5 — Cleanup

- Rotate/revoke restore target credentials if needed.
- Ensure no production secrets were copied into non-prod environments.

