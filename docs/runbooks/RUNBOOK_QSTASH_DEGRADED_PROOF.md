# Runbook: Force QStash Publish Failure (Production) — Watchtower Degraded Proof

**Role:** Principal DevOps + Next.js API engineer  
**Goal:** Force one intentional QStash publish failure so `/api/sync` returns 200 degraded and Watchtower becomes WATCHTOWER_DEGRADED within 15 minutes.

## Zero-Tolerance Conversion Time Guard

Even in degraded mode, conversion timestamp source must remain first-intent SSOT.
- Policy: `docs/OPS/OCI_CONVERSION_TIME_ZERO_TOLERANCE.md`
- Degradation does not permit timestamp source override.

---

## 1) Confirm we're hitting production + correct project

```powershell
curl.exe -s -D - "https://console.opsmantik.com/api/sync" -o NUL | findstr /I "x-opsmantik-commit x-opsmantik-branch x-vercel-id"
```

**Expected:**
- `x-opsmantik-branch: master`
- `x-opsmantik-commit: c1d30b47...` (or current deploy SHA)
- `x-vercel-id: ...`

If not matching, we're not testing the right deploy.

---

## 2) Break QStash token in Vercel (production env, correct project)

1. **Vercel Dashboard** → Project: **OpsMantik** (the one serving console.opsmantik.com)
2. **Settings** → **Environment Variables**
3. Select **Production** environment
4. Locate **QSTASH_TOKEN**
5. Edit: set to **original_value** + `_BROKEN` (e.g. `eyJ...xyz_BROKEN`)
6. **Save**
7. **Deployments** → **Redeploy** latest production deployment

**Important:** Ensure you edited **Production** env, not Preview/Development.

---

## 3) Verify degraded sync (must flip from queued → degraded)

From repo root (so `proof.json` is found):

```powershell
curl.exe -s -i "https://console.opsmantik.com/api/sync" `
  -H "Content-Type: application/json" `
  -H "Origin: https://www.sosreklam.com" `
  --data-binary "@proof.json"
```

**Expected:**
- **HTTP 200**
- Body includes `"status":"degraded"` (or `status: degraded`)
- And/or header: `x-opsmantik-degraded: qstash_publish_failed`

If it still returns `"status":"queued"`, stop: the token change did not apply to the active deployment (redeploy or check env scope).

---

## 4) Verify Watchtower degrades within 15 minutes

Wait up to 15 minutes (Vercel Cron runs watchtower every 15 min), then:

```powershell
curl.exe -s "https://console.opsmantik.com/api/cron/watchtower" -H "x-vercel-cron: 1"
```

**Expected:**
- `code` = **WATCHTOWER_DEGRADED**
- `failure_count` >= 1
- `checks.ingestPublishFailuresLast15m.count` >= 1

---

## 5) Verify logs

In **Vercel** → **Logs**, search for:

```text
INGEST_PIPELINE_DEGRADED
```

Confirm at least one log line with that message (and code `INGEST_PUBLISH_FAILURE`, `failure_count`).

---

## 6) Restore

1. **Vercel** → **Settings** → **Environment Variables** → **Production**
2. Set **QSTASH_TOKEN** back to original value (remove `_BROKEN`)
3. **Save**
4. **Deployments** → **Redeploy** latest production

---

## proof.json

Must exist at repo root for step 3. Minimal valid payload (site `s` = 32-hex public_id, `url` or `u` required). Current `proof.json` in repo is valid; replace `s` with a real site public_id if you want the failure row to reference an existing site.
