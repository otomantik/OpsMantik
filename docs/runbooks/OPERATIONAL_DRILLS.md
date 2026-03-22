# Operational drills (tabletop)

**Purpose:** Validate runbooks and on-call muscle memory without a live incident. **Do not edit the plan file** in `.cursor/plans/` during drills—update runbooks here.

---

## Cadence

| Drill | Frequency | Owner |
|-------|-----------|--------|
| Sync 429 / CORS / rate limit | Annual | Platform |
| OCI export / ack failure | Annual | OCI owner |
| Consent / GDPR erase path | Annual | Compliance |

---

## Drill 1 — Sync 429 & CORS

**Runbook:** [DEPLOY_SYNC_429_SITE_SCOPED_RL.md](./DEPLOY_SYNC_429_SITE_SCOPED_RL.md)

**Scenario:** A customer reports all sync requests fail with 403/429 from browser.

**Steps:**

1. Open Vercel → `ALLOWED_ORIGINS` — confirm customer origin present.
2. Check `OPSMANTIK_SYNC_RL_SITE_OVERRIDE` format (`public_id:limit`).
3. Verify Redis/Upstash reachable from Vercel.
4. Document: actual root cause, time to mitigate, gaps in runbook.

**Success:** Team completes steps in &lt;30 min using only runbook + dashboard; runbook updated if steps were wrong.

---

## Drill 2 — OCI export backlog

**Scenario:** Queue depth grows; no exports reaching Google.

**References:** [OPS/OBSERVABILITY_REQUIREMENTS.md](../architecture/OPS/OBSERVABILITY_REQUIREMENTS.md) (External dependencies), OCI runbooks under `docs/runbooks/`.

**Steps:**

1. Confirm cron auth and `/api/cron/oci/*` routes healthy.
2. Check Sentry for OCI-related errors (see [SENTRY_INVESTIGATION.md](../architecture/OPS/SENTRY_INVESTIGATION.md)).
3. Inspect `offline_conversion_queue` / projection status per `GET /api/metrics` (cron-auth).

**Success:** Identified layer (config vs credentials vs Google API) without guessing.

---

## Drill 3 — Rollback mindset

**Scenario:** Last deploy broke sync.

**Steps:**

1. Vercel → previous deployment → Redeploy.
2. Verify `/api/health` and `npm run smoke:intent-multi-site` post-rollback.
3. If DB migration already applied: follow **forward-fix** path in migration notes—never drop columns in panic.

**Success:** Documented who can trigger rollback and verification checklist.

---

## After each drill

- [ ] Update the relevant runbook with missing steps.
- [ ] Add a line to [OBSERVABILITY_BASELINE.md](../architecture/OPS/OBSERVABILITY_BASELINE.md) § CI table if tooling changed.
