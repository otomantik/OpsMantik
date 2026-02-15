## Temporary quota unblock (2026-02-15)

**Goal:** Unblock sites currently hitting quota-exceeded (`429` with `x-opsmantik-quota-exceeded: 1`) while the “karma billing” and tracker spam fixes roll out.

**Policy (temporary):**
- `monthly_limit = 50000`
- `soft_limit_enabled = true`
- `hard_cap_multiplier = 2`

### 1) DB prerequisite

Apply this migration first (enables reliable identification of quota rejects and event types):

- `supabase/migrations/20260215130000_ingest_idempotency_billing_metadata.sql`

### 2) Find sites blocked today

Run in Supabase SQL editor:

```sql
-- Sites that were rejected by quota today (UTC)
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

### 3) Upsert site_plans for all blocked-today sites

```sql
-- Upsert temporary plan settings for all sites rejected by quota today (UTC).
WITH blocked AS (
  SELECT DISTINCT i.site_id
  FROM public.ingest_idempotency i
  WHERE i.billable = false
    AND i.billing_reason = 'rejected_quota'
    AND i.created_at >= (now() AT TIME ZONE 'UTC')::date
)
INSERT INTO public.site_plans (site_id, plan_tier, monthly_limit, soft_limit_enabled, hard_cap_multiplier)
SELECT b.site_id, 'temp_unblock', 50000, true, 2
FROM blocked b
ON CONFLICT (site_id) DO UPDATE
SET
  plan_tier = EXCLUDED.plan_tier,
  monthly_limit = EXCLUDED.monthly_limit,
  soft_limit_enabled = EXCLUDED.soft_limit_enabled,
  hard_cap_multiplier = EXCLUDED.hard_cap_multiplier,
  updated_at = now();
```

### 4) Proof query (after upsert)

```sql
-- Sanity: show current plan settings for the affected sites
WITH blocked AS (
  SELECT DISTINCT i.site_id
  FROM public.ingest_idempotency i
  WHERE i.billable = false
    AND i.billing_reason = 'rejected_quota'
    AND i.created_at >= (now() AT TIME ZONE 'UTC')::date
)
SELECT
  sp.site_id,
  s.public_id,
  s.domain,
  sp.plan_tier,
  sp.monthly_limit,
  sp.soft_limit_enabled,
  sp.hard_cap_multiplier,
  sp.updated_at
FROM public.site_plans sp
JOIN blocked b ON b.site_id = sp.site_id
JOIN public.sites s ON s.id = sp.site_id
ORDER BY sp.updated_at DESC;
```

