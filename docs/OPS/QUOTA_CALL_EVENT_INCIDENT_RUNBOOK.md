## Quota + Call-Event Incident Runbook

**Symptoms**
- Browser console shows `POST /api/sync 429` with headers:
  - `x-opsmantik-quota-exceeded: 1`
  - `x-opsmantik-quota-remaining: 0`
  - `Retry-After: <seconds>`
- Tracker outbox grows / “tıkandı kaldı” hissi.
- `POST /api/call-event/v2 500` on some sites (often unsigned mode).

---

## 1) First check: is this quota or rate limit?

### A) Quota (billing)
- **Status**: `429`
- **Header**: `x-opsmantik-quota-exceeded: 1`
- **Meaning**: monthly limit/hard cap hit. `Retry-After` usually points to next UTC month boundary.

### B) Rate limit (abuse/DoS protection)
- **Status**: `429`
- **Header**: `x-opsmantik-ratelimit: 1`
- **Meaning**: per-minute bucket hit. `Retry-After` is short (seconds).

---

## 2) Immediate mitigation (temporary unblock)

Use the documented SQL playbook:
- `docs/OPS/TEMP_QUOTA_UNBLOCK_SITES_2026-02-15.md`

Policy (temporary):
- `monthly_limit = 50000`
- `soft_limit_enabled = true`
- `hard_cap_multiplier = 2`

---

## 3) Root cause patterns

### A) Tracker spam: scroll depth flood
- If you see `scroll_depth` logs incrementing `58, 59, 60...` this is a bug.
- Fix is in tracker: send 50% and 90% only once per session.

### B) Client retry storm on quota-exceeded
- If quota is exceeded, retrying is useless and can block the queue.
- Client must pause using `Retry-After` when header `x-opsmantik-quota-exceeded: 1` exists.

### C) call-event/v2 500 (schema drift)
- Older DB schema missing some `calls` columns can cause 500 on insert.
- Route now retries insert by stripping unknown columns (best-effort store).

---

## 4) SQL proof queries (after migration `20260215130000_ingest_idempotency_billing_metadata.sql`)

### A) Quota rejects today (UTC)

```sql
SELECT
  i.site_id,
  s.public_id,
  s.domain,
  COUNT(*) AS rejects_today
FROM public.ingest_idempotency i
JOIN public.sites s ON s.id = i.site_id
WHERE i.billable = false
  AND i.billing_reason = 'rejected_quota'
  AND i.created_at >= (now() AT TIME ZONE 'UTC')::date
GROUP BY i.site_id, s.public_id, s.domain
ORDER BY rejects_today DESC;
```

### B) “Karma billing” distribution for a site (this month)

```sql
SELECT
  year_month,
  billing_reason,
  billable,
  COUNT(*) AS c
FROM public.ingest_idempotency
WHERE site_id = 'YOUR_SITE_UUID'
  AND year_month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
GROUP BY year_month, billing_reason, billable
ORDER BY c DESC;
```

---

## 5) Verification checklist (after deploy)

- **Sync**:
  - quota reject: `429` + `x-opsmantik-quota-exceeded: 1` + body `{ "status": "rejected_quota" }`
  - rate limit: `429` + `x-opsmantik-ratelimit: 1`
- **Client**:
  - quota-exceeded → queue pauses (no retry storm)
  - scroll_depth → max 2 events (50% and 90%)
- **Call-event/v2**:
  - No 500; if DB missing columns, it should still return 200 (best-effort insert)

