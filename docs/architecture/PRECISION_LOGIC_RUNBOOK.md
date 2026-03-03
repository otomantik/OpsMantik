# Precision Logic Runbook — Edge Proxy IP & DB Optimization

**Amaç:** Vercel/Cloudflare edge IP (Düsseldorf/Frankfurt) yerine gerçek kullanıcı IP'si kullanımı ve Supabase partition pruning / performans optimizasyonu.

---

## 1. Edge Validation Logic

### 1.1 IP Header Önceliği

`lib/edge-client-ip.ts` kullanın; standart `ip` veya Vercel geo objesini doğrudan kullanmayın.

| Öncelik | Header | Açıklama |
|---------|--------|----------|
| 1 | `cf-connecting-ip` | Cloudflare gerçek client IP |
| 2 | `x-real-ip` | Son proxy'nin gördüğü IP |
| 3 | `x-forwarded-for` (ilk) | Chain'deki ilk IP |

### 1.2 Bot / Edge Proxy Etiketleme

- Geo city **Düsseldorf** veya **Frankfurt** **ve**
- User-Agent **AdsBot** veya **Googlebot** içeriyorsa
→ `tag: 'SYSTEM_BOT'` — DB'ye geo yazma, etiketle.
- Sadece ghost city (bot yok) → `tag: 'EDGE_PROXY'` — geo yazma.

**Entegrasyon örneği (sync/ingest):**

```ts
import { resolveEdgeClient } from '@/lib/edge-client-ip';
import { extractGeoInfo } from '@/lib/geo';

const city = req.headers.get('cf-ipcity') ?? req.headers.get('x-vercel-ip-city');
const edge = resolveEdgeClient(req, { geoCity: city });

if (edge.isEdgeProxyOrBot) {
  // geo_city = null, geo_source = 'UNKNOWN' veya tag kaydet
  return;
}
// Normal geo extraction devam eder
```

---

## 2. Supabase DB Optimization

### 2.1 Partition Pruning — COALESCE Kaldırma

**Sorun:** `s.created_month = COALESCE(c.session_created_month, date_trunc(...))` partition pruning'ı bozar; planner tüm partition'ları taramak zorunda kalır.

**Çözüm:** `calls.session_created_month` kolonunu zorunlu yap; COALESCE kaldır.

### 2.2 Migration: session_created_month Constraint + Trigger

```sql
-- Migration: 20260625000000_precision_logic_session_created_month.sql
-- Calls tablosunda session_created_month: matched_session_id varsa ZORUNLU

BEGIN;

-- 1) Backfill: tüm NULL'ları doldur
UPDATE public.calls c
SET session_created_month = date_trunc('month', c.matched_at AT TIME ZONE 'utc')::date
WHERE c.session_created_month IS NULL
  AND c.matched_session_id IS NOT NULL
  AND c.matched_at IS NOT NULL;

-- 2) Trigger: INSERT/UPDATE'te matched_session_id varsa session_created_month zorunlu
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

### 2.3 COALESCE Kaldırılmış RPC (get_call_session_for_oci)

```sql
-- s.created_month = c.session_created_month (COALESCE YOK)
AND s.created_month = c.session_created_month
```

**Not:** `session_created_month` NULL olan eski çağrılar için JOIN'de eşleşme olmaz; bu beklenen davranış (zaten backfill yapıldı).

### 2.4 Covering Index Önerileri

```sql
-- calls: Index-Only Scan için (BI Export, dashboard filtreleri)
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

GCLID varsa: gerçek kullanıcı (İstanbul hedefli); yoksa: Proxy.

```sql
-- Repair: sessions tablosunda Düsseldorf/Frankfurt ghost → normalize
-- Çalıştırma: Supabase SQL Editor, site/tenant scope uygulanabilir

-- sessions: city + geo_city (RPC'ler city kullanır; geo_city master)
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

**Dikkat:** `sessions` partition olduğu için UPDATE `created_month` ile birlikte yapılmalı. Partition key değiştirilemez; yalnızca `city`/`district` veya `geo_city`/`geo_district` güncellenir.

### 3.2 marketing_signals Autovacuum (Index Bloat Önleme)

```sql
-- marketing_signals: append-only, sık INSERT; bloat riski yüksek
ALTER TABLE public.marketing_signals SET (
  autovacuum_vacuum_scale_factor = 0.02,   -- %2 dead row'da vacuum
  autovacuum_analyze_scale_factor = 0.01,  -- %1'de analyze
  autovacuum_vacuum_cost_delay = 2,
  autovacuum_vacuum_cost_limit = 1000
);

COMMENT ON TABLE public.marketing_signals IS
  'Aggressive autovacuum: scale_factor 0.02 to prevent index bloat on high-insert table.';
```

---

## 4. Refactored BI Export SQL

Partition pruning uyumlu, COALESCE kaldırılmış, covering index kullanımına uygun.

### 4.1 Conversion Granularity (ROAS)

```sql
-- BI Export: conversion (partition-safe, no COALESCE)
-- Önkoşul: session_created_month trigger ile zorunlu
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
  AND s.created_month = c.session_created_month  -- Partition pruning, COALESCE yok
LEFT JOIN marketing_signals ms
  ON ms.call_id = c.id AND ms.site_id = c.site_id
WHERE oq.site_id = :site_id
  AND oq.status = 'COMPLETED'
  AND oq.created_at BETWEEN :from_ts AND :to_ts
ORDER BY oq.conversion_time DESC;
```

### 4.2 Call Granularity (Operasyonel)

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

**Uyarı:** `c.session_created_month` NULL olan call'larda sessions JOIN eşleşmez. Repair + trigger sonrası yeni kayıtlarda NULL olmayacak.

---

## 5. Uygulama Sırası

1. **Migration:** `20260625000000_precision_logic_session_created_month.sql` (trigger + backfill)
2. **Index'ler:** Covering index migration
3. **Autovacuum:** marketing_signals ALTER
4. **Repair:** Ghost scrub (bir kez, bakım penceresinde)
5. **Kod:** `lib/edge-client-ip.ts` → sync/call-event entegrasyonu
6. **RPC/BI:** COALESCE kaldırılmış sorgulara geçiş
