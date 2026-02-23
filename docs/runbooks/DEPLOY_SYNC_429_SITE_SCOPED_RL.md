# Deploy: Site-Scoped Rate Limit (Sync 429 Fix)

The **site-scoped rate limit** code is on `master` to address 429 responses blocking events. Use one of the following to roll it out to production.

## CORS: Origin Allowlist (If You Get 429 / CORS Errors)

Sync and call-event APIs accept requests only from origins listed in **ALLOWED_ORIGINS**. For production, ensure one of these is defined:

- `https://www.poyrazantika.com`
- or `https://poyrazantika.com` (subdomains accepted)

**Vercel → Settings → Environment Variables:**

- **Key:** `ALLOWED_ORIGINS`
- **Value:** Append to current value: `,https://www.poyrazantika.com` (or comma-separated full list, e.g. `https://console.opsmantik.com,https://www.poyrazantika.com,...`)

Save + Production redeploy. If origin is not in the list, 403 is returned; the browser may show this as a CORS error.

## Emergency Relief: Site Limit Override (If No Events Flow Today)

Add to Vercel (or hosting) **Environment Variables**:

- **Name:** `OPSMANTIK_SYNC_RL_SITE_OVERRIDE`
- **Value:** `b3e9634575df45c390d99d2623ddcde5:500`

This sets the limit to **500/min** for that site instead of 100; events start flowing again. Trigger deploy (save + redeploy). Remove when no longer needed to revert to default 100.

## 1) Vercel Auto Deploy (If GitHub Connected)

If code was pushed to `master`, Vercel usually deploys automatically.

- **Check:** [Vercel Dashboard](https://vercel.com) → Project → Deployments. If the latest deployment is from `master` (commit `726581c` or later), deploy may already be live.
- **New deploy:** Same page → **Redeploy** (click latest deployment → Redeploy) or push a new commit.

## 2) Deploy via Vercel CLI

```bash
cd /path/to/opsmantik-v1
npx vercel --prod
```

Use `npx vercel login` first if needed.

## 3) Post-Deploy Verification

1. **API response:** When a request receives 429, the response must include the **`Retry-After`** header (new code).
2. **Diagnostic script:**
   ```bash
   node scripts/check-poyraz-ingest.mjs
   ```
   After some time, "Events today" and "ingest_idempotency rows today" should increase.

## Commit (merge)

- `726581c` — merge: sync 429 TMS hardening (site-scoped RL + Retry-After + batch/throttle + P1 hardening).
