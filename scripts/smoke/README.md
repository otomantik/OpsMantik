# Smoke scripts

## tenant-isolation-proof.mjs

Proves call-event matching (and thus tenant isolation) is site-scoped: same fingerprint on site A and B must never match the other site's session.

### Required env

- `SUPABASE_URL` – Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` – Service role key (bypasses RLS)
- `SITE_A_ID` – Existing site: **sites.id** (UUID) or **sites.public_id** (32-char hex). Script resolves public_id to id for DB inserts.
- `SITE_B_ID` – Another existing site: same (UUID or public_id).

### Optional (API mode, preferred)

- `CALL_EVENT_BASE_URL` – App base URL (e.g. `https://yourapp.vercel.app`)
- `CALL_EVENT_SECRET` – Secret used to sign the call-event request (script sets it for site A via `rotate_site_secret_v1` so the request validates)

If both are set, the script calls `POST /api/call-event/v2` with a valid signature and asserts the response matches only site A’s session. Otherwise it runs a direct DB query (events for site A + fingerprint) and asserts the same.

### Run on Windows PowerShell

From the project root:

```powershell
# Required (replace with your values)
$env:SUPABASE_URL = "https://xxxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "eyJ..."
$env:SITE_A_ID = "uuid-of-site-a"
$env:SITE_B_ID = "uuid-of-site-b"

# Optional: use API mode (needs app deployed and reachable)
$env:CALL_EVENT_BASE_URL = "https://yourapp.vercel.app"
$env:CALL_EVENT_SECRET = "your-secret-for-site-a"

node scripts/smoke/tenant-isolation-proof.mjs
```

One-liner (inline env):

```powershell
$env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."; $env:SITE_A_ID="uuid-a"; $env:SITE_B_ID="uuid-b"; node scripts/smoke/tenant-isolation-proof.mjs
```

With API mode:

```powershell
$env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."; $env:SITE_A_ID="uuid-a"; $env:SITE_B_ID="uuid-b"; $env:CALL_EVENT_BASE_URL="https://yourapp.vercel.app"; $env:CALL_EVENT_SECRET="secret"; node scripts/smoke/tenant-isolation-proof.mjs
```

### Output

- **PASS**: Matched session is site A only; site B session never returned. Exit code 0.
- **FAIL**: Matched session is wrong or missing. Exit code 1.

Inserted rows are tagged with `attribution_source = 'smoke_tenant_isolation'` and metadata `smoke_tenant_isolation: true`; the script deletes them at the end.
