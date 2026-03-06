# Revenue Kernel — Post-Deploy Checklist

This list covers steps to complete after Revenue Kernel deploy (dispute-export, invoice-freeze, metrics, cleanup batch, Redis metrics). Check each item when done.

---

## 1. Migration

- [ ] **Idempotency cleanup RPC:** Was `supabase/migrations/20260217000000_idempotency_cleanup_batch_rpc.sql` applied?  
  - Run `supabase db push` or execute SQL in Supabase Dashboard.  
  - Otherwise `POST /api/cron/idempotency-cleanup` returns 500 (RPC not found).

---

## 2. Environment (Production)

- [ ] **Redis (Upstash):** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` set in production env.  
  - Billing metrics are written to Redis; `GET /api/metrics` reads from Redis (`ingest_source: redis`).  
  - Otherwise metrics remain in-memory only (per instance).

- [ ] **CRON dual-key:** Production cron execution now requires both trusted Vercel provenance (`X-Vercel-Cron: 1` + `x-vercel-id`) and `Authorization: Bearer <CRON_SECRET>`.
  - `CRON_SECRET` must be non-empty and not a placeholder/default value.
  - Header-only prod calls must fail closed with `CRON_FORBIDDEN`.

- [ ] **Tracker shadow mode flag:** If you are monitoring tracker rollout drift, set `OPSMANTIK_TRACKER_SHADOW_MODE=true` in production before the smoke window.
  - Backend accepts traffic but logs `STALE_TRACKER_DETECTED` when payloads miss `meta.om_tracker_version`.

---

## 3. Test

- [ ] **Lifecycle test:** Run `tests/billing/lifecycle.test.ts` (with Supabase + CRON_SECRET env).  
  - Old rows (91 days) must be deleted; current month rows must not be deleted.
- [ ] **Focused release gates:** Run `npm run test:release-gates` before production deploy.  
  - This must cover `test:tenant-boundary`, `test:oci-kernel`, and `smoke:intent-multi-site` without failures.
  - `npm run predeploy` now maps to the same full gate.
- [ ] **Evidence artifact:** Run `npm run release:evidence` and keep the generated markdown with the release record.  
  - Default artifact path: `tmp/release-gates-latest.md`.
  - CI path: `.github/workflows/release-gates.yml` uploads `release-gate-evidence` automatically on `master` / `main` pushes.
  - GitHub enforcement setup: `docs/runbooks/GITHUB_RELEASE_GATES_REQUIRED_CHECK.md`.

---

## 4. Cron schedule (Vercel or your platform)

`vercel.json` currently has only watchtower and recover. Add the following via Vercel Dashboard or `vercel.json`:

- [ ] **Idempotency cleanup:** `POST /api/cron/idempotency-cleanup` — daily 03:00 UTC.  
- [ ] **Reconcile usage:** `GET /api/cron/reconcile-usage` (or enqueue + run separately) — daily or hourly.  
- [ ] **Invoice freeze:** `POST /api/cron/invoice-freeze` — 1st of month 00:00 UTC.  
- [ ] **Metrics (optional):** `GET /api/metrics` — add to schedule if scraping is needed.

---

## 5. Smoke (one-time)

- [ ] **Release-gate record:** Attach or note the successful `npm run test:release-gates` run in the release evidence.  
  - Do not treat deploy as complete if tenant-boundary or OCI-kernel gates were skipped.
- [ ] **Cleanup dry_run:**  
  `curl -X POST "https://<APP_URL>/api/cron/idempotency-cleanup?dry_run=true" -H "Authorization: Bearer $CRON_SECRET"`  
  → 200, `would_delete` or 0.

- [ ] **Metrics:**  
  `curl -H "Authorization: Bearer $CRON_SECRET" "https://<APP_URL>/api/metrics"`  
  → 200, `billing.ingest`, `billing.ingest_source` (redis | memory).

---

## 6. Later (as needed)

- **PR-9 (partition/BRIN):** Per `docs/architecture/OPS/SCALING_INGEST_IDEMPOTENCY.md` runbook; evaluate when row count ~5–10M or reconciliation/cleanup slows.

---

**Note:** All cron routes use `requireCronAuth`; in production hybrid mode, Vercel cron headers plus `Authorization: Bearer <CRON_SECRET>` are both required.
