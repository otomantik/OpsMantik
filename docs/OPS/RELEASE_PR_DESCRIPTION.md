# Release PR description — copy-paste

**Kullanım:** GitHub’da release PR açarken (base: master, compare: release/revenue-kernel-pr1-4) aşağıdaki metni **Description** alanına yapıştır.

---

🚀 **Release: Revenue Kernel PR-1..PR-4 (Fail-Secure + Reconciliation + Runbook)**

## 📦 Scope

This PR merges Revenue Kernel PR-1..PR-4 into master.

**Included:**
- ✅ Idempotent ingest ledger (ingest_idempotency) as financial source of truth
- ✅ Fail-secure financial gate (DB error = 500, no publish)
- ✅ Quota vs Rate-limit separation (distinct headers)
- ✅ Reconciliation authority = PostgreSQL (NOT Redis)
- ✅ FOR UPDATE SKIP LOCKED job runner
- ✅ Watchtower health check (billing drift + publish failures)
- ✅ Release runbook documentation

**Excluded:** PR-9 scaling migrations, Backfill endpoint, Invoice freeze, Metrics endpoint (Future pack handled in separate branch)

## 🔐 Financial Guarantees (Hard Rules)

- **Ledger SoT:** Invoice count = ingest_idempotency.billable = true
- **Fail-Secure:** If DB idempotency insert fails → return 500 → DO NOT publish
- **Duplicate path:** 200 + x-opsmantik-dedup → NOT billable
- **Quota reject:** 429 + x-opsmantik-quota-exceeded
- **Rate limit:** 429 + x-opsmantik-ratelimit
- **Reconciliation drift detection:** max(10, 1% of billable)

All above are covered by unit + gate tests.

## 🧪 Tests

**Revenue Gate Tests:** Duplicate → no publish; DB down → 500 + billing_gate_closed; Quota reject → no publish, billable=false; QStash failure → fallback only after idempotency row exists.

**Reconciliation Tests:** Source = ingest_idempotency only; Job runner uses FOR UPDATE SKIP LOCKED; Drift threshold logic verified.

All tests passing before merge.

## 🧪 Post-Merge Smoke (Production)

```powershell
$CONSOLE_URL="https://console.opsmantik.com"
$CRON_SECRET="YOUR_SECRET"

# Watchtower
curl.exe -s -X GET "$CONSOLE_URL/api/cron/watchtower" -H "Authorization: Bearer $CRON_SECRET"

# Reconciliation Run
curl.exe -s -X POST "$CONSOLE_URL/api/cron/reconcile-usage/run" -H "Authorization: Bearer $CRON_SECRET"
```

**Expected:** Watchtower → `"code": "WATCHTOWER_OK", "severity": "ok"`; Reconcile run → `"processed": N, "completed": N, "failed": 0`.

## 🧾 Reconciliation Proof Query (DB)

```sql
SELECT
  i.site_id,
  i.year_month,
  i.billable_count,
  u.event_count
FROM (
  SELECT site_id, year_month, count(*)::int AS billable_count
  FROM ingest_idempotency
  WHERE billable = true
  GROUP BY 1, 2
) i
LEFT JOIN site_usage_monthly u
  ON u.site_id = i.site_id AND u.year_month = i.year_month
ORDER BY i.billable_count DESC;
```

**Expected:** billable_count == event_count

## 🧯 Rollback Plan

If any regression: `git revert <merge_commit_sha>` then `git push origin master`. No DB migration required for this release.

## 📚 Docs

- docs/OPS/REVENUE_KERNEL_RELEASE_RUNBOOK.md
- docs/BILLING/REVENUE_KERNEL_IMPLEMENTATION_EVIDENCE.md

## 🧠 Summary

This release locks the Revenue Kernel financial layer: deterministic billing, no silent data loss, no Redis invoice authority, reconciliation safety net, fully tested fail-secure pipeline. If approved, safe to merge into master.
