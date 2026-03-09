# Precision Logic Runbook — Edge Proxy IP & DB Optimization

**Goal:** Use real client IP instead of Vercel/Cloudflare edge IP (Düsseldorf/Frankfurt), and Supabase partition pruning / performance optimization.

---

## 1. Edge Validation Logic

### 1.1 IP Header Priority

The app currently uses `lib/request-client-ip` (getClientIp). Edge/proxy discrimination may be added later; when it is, header priority will be: `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for` (first).

| Priority | Header | Description |
|----------|--------|-------------|
| 1 | `cf-connecting-ip` | Cloudflare real client IP |
| 2 | `x-real-ip` | IP as seen by the last proxy |
| 3 | `x-forwarded-for` (first) | First IP in the chain |

### 1.2 Bot / Edge Proxy Tagging

- If geo city is **Düsseldorf** or **Frankfurt** **and**
- User-Agent contains **AdsBot** or **Googlebot**
→ `tag: 'SYSTEM_BOT'` — do not write geo to DB; tag only.
- If only ghost city (no bot) → `tag: 'EDGE_PROXY'` — do not write geo.

**Integration (sync/ingest):** Use `getClientIp` (lib/request-client-ip) for now. When edge/proxy discrimination is added, the same header priority and geo+UA rules will apply; example code is not kept in this runbook (module was removed).

---

## 1.3 Partition Boundary Semantics (Phase 30)

| Item | Behavior |
|------|----------|
| `session_month` | UTC month of `created_at`. Boundary edge: event at `2025-01-31T23:59:59` vs `2025-02-01T00:00:01` — different months. |
| `event_month` | Derived from session; cascade on session insert via `events_set_session_month_from_session`. |
| `calls.session_created_month` | Enforced by `calls_enforce_session_created_month`; orphan prevention. |
| Month boundary | 23:59:59 vs 00:00:01 — precision matters for partition pruning and reporting. |

---

## 2. Supabase DB Optimization

### 2.1 Partition Pruning — Removing COALESCE

**Problem:** `s.created_month = COALESCE(c.session_created_month, date_trunc(...))` breaks partition pruning; the planner has to scan all partitions.

**Solution:** Make `calls.session_created_month` mandatory; remove COALESCE.

### 2.2 Migration: session_created_month Constraint + Trigger

```sql
-- Migration: 20260625000000_precision_logic_session_created_month.sql
-- calls table: session_created_month REQUIRED when matched_session_id is set

BEGIN;

-- 1) Backfill: fill all NULLs
UPDATE public.calls c
SET session_created_month = date_trunc('month', c.matched_at AT TIME ZONE 'utc')::date
WHERE c.session_created_month IS NULL
  AND c.matched_session_id IS NOT NULL
  AND c.matched_at IS NOT NULL;

-- 2) Trigger: when matched_session_id is set on INSERT/UPDATE, session_created_month is required
CREATE OR REPLACE FUNCTION public.trg_calls_enforce_session_created_month()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.matched_session_id IS NOT NULL AND NEW.session_created_month IS NULL THEN
    NEW.session_created_month := date_trunc('month', COALESCE(NEW.matched_at, now()) AT TIME ZONE 'utc')::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calls_enforce_session_created_month ON public.calls;
CREATE TRIGGER calls_enforce_session_created_month
  BEFORE INSERT OR UPDATE OF matched_session_id, matched_at, session_created_month
  ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_calls_enforce_session_created_month();

COMMENT ON FUNCTION public.trg_calls_enforce_session_created_month() IS
  'Ensures session_created_month is set when matched_session_id present. Enables partition pruning.';

COMMIT;
```

### 2.3 RPC Without COALESCE (get_call_session_for_oci)

```sql
-- s.created_month = c.session_created_month (NO COALESCE)
AND s.created_month = c.session_created_month
```

**Note:** For legacy calls where `session_created_month` is NULL, the JOIN will not match; this is expected (backfill is applied first).

### 2.4 Covering Index Recommendations

```sql
-- calls: for index-only scan (BI export, dashboard filters)
CREATE INDEX IF NOT EXISTS idx_calls_site_status_created_covering
  ON public.calls (site_id, status, created_at DESC)
  INCLUDE (matched_session_id, session_created_month, lead_score, intent_action);

-- offline_conversion_queue: BI conversion granularity
CREATE INDEX IF NOT EXISTS idx_ocq_site_status_created_covering
  ON public.offline_conversion_queue (site_id, status, created_at DESC)
  INCLUDE (call_id, gclid, conversion_time, value_cents)
  WHERE status = 'COMPLETED';

-- marketing_signals: PENDING export
CREATE INDEX IF NOT EXISTS idx_marketing_signals_site_pending_covering
  ON public.marketing_signals (site_id, created_at)
  INCLUDE (call_id, signal_type, google_conversion_name, dispatch_status)
  WHERE dispatch_status = 'PENDING';
```

---

## 3. Ghost Data Scrubbing

### 3.1 Repair Procedure — Düsseldorf → Istanbul/Proxy

If GCLID present: real user (Istanbul-targeted); otherwise: Proxy.

```sql
-- Repair: Düsseldorf/Frankfurt ghost in sessions table → normalize
-- Run in: Supabase SQL Editor; can be scoped by site/tenant

-- sessions: city + geo_city (RPCs use city; geo_city is master)
DO $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.sessions s
  SET
    city = CASE
      WHEN (s.gclid IS NOT NULL OR s.wbraid IS NOT NULL OR s.gbraid IS NOT NULL)
        THEN 'Istanbul'
      ELSE NULL
    END,
    district = CASE
      WHEN (s.gclid IS NOT NULL OR s.wbraid IS NOT NULL OR s.gbraid IS NOT NULL)
        THEN 'TR'
      ELSE NULL
    END,
    geo_city = CASE
      WHEN (s.gclid IS NOT NULL OR s.wbraid IS NOT NULL OR s.gbraid IS NOT NULL)
        THEN 'Istanbul'
      ELSE NULL
    END,
    geo_district = CASE
      WHEN (s.gclid IS NOT NULL OR s.wbraid IS NOT NULL OR s.gbraid IS NOT NULL)
        THEN 'TR'
      ELSE NULL
    END,
    geo_source = CASE
      WHEN (s.gclid IS NOT NULL OR s.wbraid IS NOT NULL OR s.gbraid IS NOT NULL)
        THEN 'ADS'
      ELSE 'UNKNOWN'
    END
  WHERE LOWER(TRIM(COALESCE(s.city, s.geo_city, ''))) IN (
    'düsseldorf', 'dusseldorf', 'frankfurt', 'ashburn', 'rome', 'amsterdam', 'roma'
  );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Ghost repair: % sessions updated', v_updated;
END $$;
```

**Caution:** Because `sessions` is partitioned, UPDATE must respect `created_month`. The partition key cannot be changed; only `city`/`district` or `geo_city`/`geo_district` are updated.

### 3.2 marketing_signals Autovacuum (Index Bloat Prevention)

```sql
-- marketing_signals: append-only, frequent INSERTs; high bloat risk
ALTER TABLE public.marketing_signals SET (
  autovacuum_vacuum_scale_factor = 0.02,   -- vacuum at 2% dead rows
  autovacuum_analyze_scale_factor = 0.01,  -- analyze at 1%
  autovacuum_vacuum_cost_delay = 2,
  autovacuum_vacuum_cost_limit = 1000
);

COMMENT ON TABLE public.marketing_signals IS
  'Aggressive autovacuum: scale_factor 0.02 to prevent index bloat on high-insert table.';
```

---

## 4. Refactored BI Export SQL

Partition-pruning friendly, COALESCE removed, aligned with covering index usage.

### 4.1 Conversion Granularity (ROAS)

```sql
-- BI Export: conversion (partition-safe, no COALESCE)
-- Prerequisite: session_created_month enforced by trigger
SELECT
  oq.id AS conversion_id,
  oq.gclid,
  oq.wbraid,
  oq.gbraid,
  oq.conversion_time,
  (oq.value_cents::numeric / 100) AS conversion_value,
  oq.currency,
  oq.status AS queue_status,
  c.id AS call_id,
  c.phone_number,
  c.confirmed_at,
  c.lead_score,
  c.intent_action,
  c.intent_target,
  s.attribution_source,
  s.utm_source,
  s.utm_medium,
  s.utm_campaign,
  s.ads_network,
  ms.signal_type AS intent_signal,
  ms.google_conversion_name AS signal_conversion_name,
  ms.conversion_value AS signal_value
FROM offline_conversion_queue oq
JOIN calls c ON oq.call_id = c.id AND oq.site_id = c.site_id
LEFT JOIN sessions s
  ON s.id = c.matched_session_id
  AND s.site_id = c.site_id
  AND s.created_month = c.session_created_month  -- Partition pruning, no COALESCE
LEFT JOIN marketing_signals ms
  ON ms.call_id = c.id AND ms.site_id = c.site_id
WHERE oq.site_id = :site_id
  AND oq.status = 'COMPLETED'
  AND oq.created_at BETWEEN :from_ts AND :to_ts
ORDER BY oq.conversion_time DESC;
```

### 4.2 Call Granularity (Operational)

```sql
-- BI Export: call (partition-safe)
SELECT
  c.id AS call_id,
  c.created_at AS call_time,
  c.status AS call_status,
  c.oci_status,
  c.confirmed_at,
  c.lead_score,
  c.intent_action,
  c.intent_target,
  s.id AS session_id,
  s.attribution_source,
  s.utm_source,
  s.utm_medium,
  s.utm_campaign,
  s.ads_network,
  ABS(EXTRACT(EPOCH FROM (c.created_at - s.created_at))) AS proximity_seconds
FROM calls c
LEFT JOIN sessions s
  ON s.id = c.matched_session_id
  AND s.site_id = c.site_id
  AND s.created_month = c.session_created_month
WHERE c.site_id = :site_id
  AND c.created_at BETWEEN :from_ts AND :to_ts
ORDER BY c.created_at DESC;
```

**Warning:** For calls where `c.session_created_month` is NULL, the sessions JOIN will not match. After repair + trigger, new rows will not have NULL.

---

## 5. Implementation Order

1. **Migration:** `20260625000000_precision_logic_session_created_month.sql` (trigger + backfill)
2. **Indexes:** Covering index migration
3. **Autovacuum:** marketing_signals ALTER
4. **Repair:** Ghost scrub (once, in a maintenance window)
5. **Code:** Edge/proxy discrimination → sync/call-event integration (header priority + ghost city/UA rules)
6. **RPC/BI:** Switch to queries without COALESCE
