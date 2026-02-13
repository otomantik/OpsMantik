# PR Gate: Watchtower + Build-Info — Verification & Closure

This checklist proves production is running the expected code and that ingestion-degradation detection works end-to-end.

---

## Why this closes the gate

We added (1) build-info headers (`x-opsmantik-commit`, `x-opsmantik-branch`) to watchtower and sync for deployment verification, and (2) Watchtower ingestion-degradation check (`ingestPublishFailuresLast15m`). The gate is closed when we show: **prod responds with the expected headers**, **Watchtower always includes the new check**, **one controlled publish failure leads to WATCHTOWER_DEGRADED and INGEST_PIPELINE_DEGRADED in logs within 15 minutes**, and **we restore configuration after proof**. No change to user-facing JSON bodies beyond what was already approved.

---

## A) Commit & push

Run from repo root (PowerShell):

```powershell
cd "c:\Users\serka\OneDrive\Desktop\project\opsmantik-v1"

git add lib/build-info.ts app/api/cron/watchtower/route.ts app/api/sync/route.ts tests/unit/build-info.test.ts docs/PR_GATE_WATCHTOWER_BUILDINFO.md
git status

git commit -m "feat: build-info headers (x-opsmantik-commit, x-opsmantik-branch) on watchtower + sync; unit tests"

git push origin master
```

**Expected:** Push succeeds; Vercel triggers a new deployment. Note the new commit SHA (e.g. from `git log -1 --oneline`).

---

## B) Post-deploy verification (production)

Replace `CONSOLE_URL` with your production base URL (e.g. `https://console.opsmantik.com`). Run after the deployment has finished (Vercel dashboard: Deployment ready).

### B1) Build-info headers on sync

```powershell
$url = "https://console.opsmantik.com/api/sync"
$r = curl.exe -s -D - -X GET "$url" 2>$null
$r | Select-String -Pattern "x-opsmantik-commit|x-opsmantik-branch"
```

**Expected:** Lines like:
- `x-opsmantik-commit: <sha>` (e.g. 7–40 char hex) or `unknown`
- `x-opsmantik-branch: main` (or your branch) or `unknown`

On Vercel, these will be the deployed commit SHA and branch; locally they would be `unknown`.

### B2) Build-info headers on watchtower (requires cron auth)

```powershell
$url = "https://console.opsmantik.com/api/cron/watchtower"
curl.exe -s -i -X GET $url -H "x-vercel-cron: 1"
```

**Expected:** Response status 200; headers include:
- `x-opsmantik-commit: <sha>` or `unknown`
- `x-opsmantik-branch: main` or `unknown`

### B3) Watchtower JSON includes `ingestPublishFailuresLast15m` (prod)

```powershell
$url = "https://console.opsmantik.com/api/cron/watchtower"
$body = (curl.exe -s -X GET $url -H "x-vercel-cron: 1")
$json = $body | ConvertFrom-Json
$json.checks.ingestPublishFailuresLast15m
```

**Expected:** Object with `status` and `count`, e.g.:
```
status count
------ -----
ok         0
```

This confirms prod Watchtower (not just local) returns the new check.

---

## C) Controlled failure injection plan

Goal: One ingest publish failure → within 15 minutes Watchtower reports WATCHTOWER_DEGRADED and logs INGEST_PIPELINE_DEGRADED.

### C1) Create minimal proof payload

Save as `proof.json` in repo root (use a real site public_id from your project, or a 32-hex test id):

```json
{"s":"00000000000000000000000000000000","url":"https://example.com/","sid":"00000000-0000-4000-8000-000000000001","sm":"2026-02-01","ec":"interaction","ea":"view","meta":{}}
```

If your DB has a test site, replace `"s"` with that site’s `public_id`.

### C2) Temporarily break QStash (inject failure)

1. Vercel Dashboard → Project → Settings → Environment Variables.
2. Find `QSTASH_TOKEN`. Copy its value to a safe place.
3. Edit `QSTASH_TOKEN`: append `_BROKEN` (or change one character). Save.
4. Redeploy the project (Deployments → … on latest → Redeploy) so the new env is used.

**Why:** With an invalid token, `qstash.publishJSON` in `/api/sync` will fail; the route will catch, write to `ingest_publish_failures`, and return 200 with degraded response/header.

### C3) Send one POST to /api/sync (must be allowed origin)

Use an origin that is in your `ALLOWED_ORIGINS` (e.g. your production console or a test domain you allow). Example with explicit Origin and path to proof.json:

```powershell
$url = "https://console.opsmantik.com/api/sync"
$origin = "https://console.opsmantik.com"
curl.exe -s -i -X POST $url -H "Content-Type: application/json" -H "Origin: $origin" -d (Get-Content -Raw proof.json)
```

**Expected:**
- Status: **200**
- Body: `"status":"degraded"` and/or header **`x-opsmantik-degraded: qstash_publish_failed`**
- Headers include `x-opsmantik-commit` and `x-opsmantik-branch`

So we’ve proved one controlled failure path and that build-info headers are present.

### C4) Wait for Watchtower (within 15 minutes)

Vercel Cron runs watchtower every 15 minutes. Wait up to 15 minutes, then:

```powershell
$url = "https://console.opsmantik.com/api/cron/watchtower"
curl.exe -s -X GET $url -H "x-vercel-cron: 1" | ConvertFrom-Json | Select-Object code, status, failure_count, @{N='ingest';E={$_.checks.ingestPublishFailuresLast15m}}
```

**Expected:**
- `code`: **WATCHTOWER_DEGRADED**
- `status`: **degraded**
- `failure_count`: **≥ 1**
- `ingest`: `status` = degraded (or critical if >5), `count` ≥ 1

### C5) Verify Vercel logs for INGEST_PIPELINE_DEGRADED

1. Vercel Dashboard → Project → Logs (or Deployment → Functions / Logs).
2. Filter by time window covering the Watchtower run after the injected failure.
3. Search for **INGEST_PIPELINE_DEGRADED** (and optionally **INGEST_PUBLISH_FAILURE**).

**Expected:** At least one log line containing `"msg":"INGEST_PIPELINE_DEGRADED"` and `"code":"INGEST_PUBLISH_FAILURE"` (and `failure_count` ≥ 1). No special log aggregation tooling required beyond Vercel’s UI.

### C6) Restore configuration

1. Vercel → Settings → Environment Variables.
2. Restore **QSTASH_TOKEN** to its original value (remove `_BROKEN` or fix the character).
3. Redeploy so the fix is live.

**Optional:** Delete the test row from `ingest_publish_failures` (e.g. via Supabase SQL Editor) so it doesn’t skew future counts.

---

## D) Post-proof audit scoring request template

Copy the following for the auditor (after the above steps are done):

---

**Request: Post-proof platform re-score**

We have closed the PR gate for Watchtower + build-info with the following proofs in production:

1. **Deployment verification:** `/api/cron/watchtower` and `/api/sync` now return headers `x-opsmantik-commit` and `x-opsmantik-branch` (Vercel-provided SHA and branch). Verified on production after deploy.
2. **Watchtower shape:** Production Watchtower response always includes `checks.ingestPublishFailuresLast15m` with `status` and `count` (verified via GET with `x-vercel-cron: 1`).
3. **Controlled failure:** We temporarily broke QStash (invalid `QSTASH_TOKEN`), sent one POST to `/api/sync`, confirmed 200 degraded response (and `x-opsmantik-degraded` where applicable), then within 15 minutes confirmed Watchtower returned `WATCHTOWER_DEGRADED` with `failure_count` ≥ 1 and that Vercel logs contained `INGEST_PIPELINE_DEGRADED`. Configuration was then restored.

Please re-score the platform (0–100) **after** these changes, with focus on:

- **Tenant isolation** (unchanged by this PR; existing smoke and RLS).
- **Durability signals** (ingest pipeline degradation now visible via Watchtower + logs; ingest_publish_failures and 15m check in prod).
- **Cron/auth** (Watchtower cron auth and schedule unchanged; build-info adds traceability).
- **Observability** (build-info headers for deployment verification; structured INGEST_PIPELINE_DEGRADED log; Watchtower status/code/severity/failure_count).

Provide an updated overall score and, if applicable, updated subscores for observability and durability/ingestion.

---

## Quick reference: PowerShell-safe curl examples

| Step              | Command (replace CONSOLE_URL) |
|-------------------|-------------------------------|
| Sync headers      | `curl.exe -s -D - -X GET "https://console.opsmantik.com/api/sync"` |
| Watchtower 200    | `curl.exe -s -i -X GET "https://console.opsmantik.com/api/cron/watchtower" -H "x-vercel-cron: 1"` |
| Watchtower JSON   | `curl.exe -s -X GET "https://console.opsmantik.com/api/cron/watchtower" -H "x-vercel-cron: 1"` |
| Sync POST (degraded) | `curl.exe -s -i -X POST "https://console.opsmantik.com/api/sync" -H "Content-Type: application/json" -H "Origin: https://console.opsmantik.com" -d (Get-Content -Raw proof.json)` |

All commands assume PowerShell; use `curl.exe` explicitly to avoid alias issues.
