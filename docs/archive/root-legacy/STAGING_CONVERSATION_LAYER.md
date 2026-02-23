# Staging Verification & E2E — Conversation Layer

## 1. Push migrations to staging (Supabase)

Use the Supabase project linked to your staging environment.

```bash
# From repo root. Ensure staging Supabase is linked (or set env for remote).
npx supabase link --project-ref <STAGING_PROJECT_REF>
# Or use env: SUPABASE_DB_URL / SUPABASE_ACCESS_TOKEN for remote apply

# Push all pending migrations (includes 20260218000000_conversation_layer_tables.sql)
npx supabase db push
```

**Alternative (SQL apply):** If you apply migrations manually (e.g. via Dashboard SQL editor or CI):

```bash
# Apply only the conversation layer migration
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260218000000_conversation_layer_tables.sql
```

Required env for `db push`: `SUPABASE_ACCESS_TOKEN` (or linked project) and DB URL for direct `psql`.

---

## 2. Run E2E script

**Env (required):**

| Variable | Purpose |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Staging Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (seed + RPC + queue read) |
| `CRON_SECRET` | Cron auth for enqueue-from-sales |
| `SMOKE_BASE_URL` | Base URL for enqueue HTTP tests. **Default:** `https://console.opsmantik.com`. Override for staging: `https://staging.opsmantik.com` or local: `http://localhost:3000`. |
| `SMOKE_SITE_ID` | (Optional) Existing site UUID. If unset, script creates a temporary site from first user and deletes it after the run. |

**Commands:**

```bash
# E2E: seed sale, confirm twice (RPC), check queue, enqueue hours (uses .env.local / .env via script)
npm run smoke:conversation-layer
# Or directly:
node scripts/smoke/conversation-layer-e2e.mjs
```

**Prod smoke (read-only / non-destructive):** Run only the enqueue **hours** bounds (no DB writes). Default base URL is `https://console.opsmantik.com`:

```bash
CRON_SECRET=<prod_cron_secret> npm run smoke:conversation-layer:hours-only
# Override base URL (e.g. staging):
SMOKE_BASE_URL=https://staging.opsmantik.com CRON_SECRET=<secret> npm run smoke:conversation-layer:hours-only
```

`--hours-only` skips seeding and confirm; only hits `POST .../enqueue-from-sales?hours=...` and asserts 400/200/400.

**PowerShell (Windows):** Set env in the same run:
```powershell
$env:SMOKE_BASE_URL="http://localhost:3000"; npm run smoke:conversation-layer
```

---

## 3. Expected output (full E2E)

```
Conversation Layer E2E
  Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, SMOKE_BASE_URL

1) Seed
   Site: <site_id>  Sale (DRAFT): <sale_id>

2) Confirm idempotency (RPC)
   First confirm: success, enqueued=true
   Second confirm: RPC error sale_already_confirmed_or_canceled

3) DB: offline_conversion_queue
   Rows for sale_id: 1

4) Enqueue-from-sales hours bounds (HTTP)
   hours=-1 => 400
   hours=0  => 400
   hours=168 => 200
   hours=169 => 400

5) Primary-source (unit coverage)
   See: npm run test:unit -- --test-name-pattern "primary-source"

All checks passed.
```

If any step fails, the script exits with code 1 and prints the failing assertion.

---

## 4. Primary-source precedence & safety

- **Precedence (callId > sessionId), tenant-safe (site_id), best-effort (null on error):** Covered by unit tests.
- Run: `npm run test:unit -- --test-name-pattern "primary-source"` (no staging required).
- Optional staging check: call `getPrimarySource(siteId, {})` and `getPrimarySource(siteId, { sessionId: '<non-existent>' })` via a small TS script; both should return `null`.
