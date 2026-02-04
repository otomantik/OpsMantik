# No Leads Today – Diagnostic Guide

When **no sealed leads (Capture)** appear for any site for "today", follow this checklist to find where the pipeline is failing.

---

## 1. Use the same "today" as the dashboard (TRT)

The dashboard uses **TRT (Turkey) today**: from 21:00 UTC previous day to 21:00 UTC today (half-open `[from, to)`). Scripts that use UTC midnight (00:00–23:59) will show different numbers.

- **Run:** `node scripts/check-today-trt.mjs`  
- This prints, for **TRT today** and each site: **sessions (ads)**, **total_leads** (intents), **sealed** (Capture).  
- Interpret:
  - **Sessions = 0** → Traffic/sync not reaching the worker (see steps 2–4).
  - **Sessions > 0, total_leads = 0** → No phone/WhatsApp clicks today (intent gate).
  - **total_leads > 0, sealed = 0** → Intents exist but none confirmed/sealed yet (queue or timing).

---

## 2. Sync API receiving requests?

- **Vercel:** Logs for `/api/sync` (POST). Check for 200 with `status: 'queued'` or 403 (origin not allowed).
- **Quick test:** From a browser on an **allowed origin** (client site in `ALLOWED_ORIGINS`), open DevTools → Network, trigger a page view or click; confirm a POST to `.../api/sync` with 200 and response like `{ ok: true, status: 'queued' }`.
- If 403: add the request’s **Origin** to `ALLOWED_ORIGINS` (comma-separated in env).

---

## 3. QStash delivering to the worker?

- **Upstash Console:** QStash → Logs / Dashboard. Check for:
  - Successful POST to `https://<your-console-domain>/api/sync/worker`.
  - Failures (4xx/5xx) or retries.
- If many failures: worker URL wrong, auth/signature issue, or worker returning errors (see step 5).

---

## 4. Worker running and not failing?

- **Vercel:** Logs for `/api/sync/worker`. Look for errors or 500.
- **DLQ:** In Supabase, query `sync_dlq` for recent rows (e.g. last 24h). If rows exist, the worker is explicitly failing (non-retryable) and the payload is stored for inspection.
- **Sentry:** Check for `sync_worker` / `QSTASH_WORKER` errors (DB, validation, etc.).

---

## 5. Pipeline logic (why sealed = 0 even with traffic)

- **Intents (total_leads)** are created only when the sync worker receives an event with a **phone/WhatsApp action**: `phone_call`, `phone_click`, `call_click`, `tel_click`, or WhatsApp equivalents. No such click → no intent → no sealed.
- **Sealed** = calls with `status IN ('confirmed','qualified','real')`. New intents start as `intent`; they become sealed after your process (e.g. manual confirm or auto-seal) updates status.
- So: **Sessions > 0, total_leads = 0** → no conversion events today. **total_leads > 0, sealed = 0** → intents are in queue or not yet marked confirmed.

---

## 6. Quick reference

| Symptom | Check |
|--------|--------|
| Sessions = 0 for TRT today | Sync API (2), QStash (3), Worker (4) |
| Sessions > 0, total_leads = 0 | No tel/WA clicks; tracker and conversion events |
| total_leads > 0, sealed = 0 | Queue/confirmation flow; not a sync bug |
| Different numbers than dashboard | Use TRT range (run `check-today-trt.mjs`, not only `check-today.mjs`) |

---

## Scripts

- **`scripts/check-today-trt.mjs`** – TRT “today” range; for each site: sessions (ads), total_leads, sealed. Use this to compare with the dashboard.
- **`scripts/check-today.mjs`** – Uses UTC midnight “today”; useful for raw DB checks but not for matching the dashboard.
