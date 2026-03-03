# BI Export Service — Query Taslağı (SQL & Data Logic)

**Amaç:** Mühürlenmiş ledger verisini BI araçlarına (Metabase, Tableau, Looker Studio vb.) servis etmek için SQL taslakları ve veri mantığı.

**Bağımlılık:** Opsmantik sealed ledger (Pipeline A: `offline_conversion_queue`, Pipeline B: `marketing_signals`).

---

## 1. Veri Modeli Özeti

| Tablo | Ana Kolonlar | Partition |
|-------|--------------|-----------|
| `offline_conversion_queue` | id, site_id, call_id, sale_id, gclid, wbraid, gbraid, conversion_time, value_cents, currency, status, provider_key | - |
| `calls` | id, site_id, phone_number, matched_session_id, session_created_month, lead_score, sale_amount, confirmed_at, intent_action, intent_target | - |
| `sessions` | id, site_id, created_month, created_at, attribution_source, utm_source, utm_medium, utm_campaign, ads_network, gclid | `created_month` |
| `marketing_signals` | id, site_id, call_id, signal_type, google_conversion_name, conversion_value, dispatch_status | - |

**Not:** Precision Logic migration sonrası `c.session_created_month` zorunlu (trigger). JOIN: `s.created_month = c.session_created_month` — COALESCE yok, partition pruning aktif.

---

## 2. A. Granularity: conversion (ROAS Odaklı)

Sadece reklam katma değeri yaratan, **mühürlenmiş ve Google Ads'e gönderilmiş** dönüşümleri getirir.

```sql
-- BI Export: conversion granularity
-- Parametreler: :site_id (uuid), :from_ts (timestamptz), :to_ts (timestamptz), :include_signals (boolean)
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
    c.phone_number,  -- EC Bridge: Phase 2'de hashed_phone ile değiştirilecek
    c.confirmed_at,
    c.lead_score,
    c.intent_action,
    c.intent_target,
    s.attribution_source,
    s.utm_source,
    s.utm_medium,
    s.utm_campaign,
    s.ads_network,
    -- Signals Enrichment (include_signals=true ise; JOIN yoksa NULL)
    ms.signal_type AS intent_signal,
    ms.google_conversion_name AS signal_conversion_name,
    ms.conversion_value AS signal_value
FROM offline_conversion_queue oq
JOIN calls c ON oq.call_id = c.id AND oq.site_id = c.site_id
LEFT JOIN sessions s
    ON s.id = c.matched_session_id
    AND s.site_id = c.site_id
    AND s.created_month = c.session_created_month
LEFT JOIN marketing_signals ms
    ON ms.call_id = c.id
    AND ms.site_id = c.site_id
    -- Uygulama katmanında include_signals=false ise bu JOIN tamamen atlanmalı (performans)
WHERE oq.site_id = :site_id
  AND oq.status = 'COMPLETED'
  AND oq.created_at BETWEEN :from_ts AND :to_ts
ORDER BY oq.conversion_time DESC;
```

**Index önerisi:**
```sql
CREATE INDEX IF NOT EXISTS idx_ocq_site_status_created
  ON public.offline_conversion_queue (site_id, status, created_at)
  WHERE status = 'COMPLETED';
```

---

## 3. B. Granularity: call (Operasyonel Odaklı)

Dönüşüm olsun ya da olmasın, tüm çağrı trafiğini ve attribution kaynaklarını döker. Çağrı merkezi performans analizi için uygun.

```sql
-- BI Export: call granularity
-- Parametreler: :site_id (uuid), :from_ts (timestamptz), :to_ts (timestamptz)
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
    -- Tie-break kontrolü (PR-OCI-7.1: callTime proximity)
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

---

## 4. C. Granularity: session (Attribution Odaklı)

Session bazlı touchpoint analizi. Events özeti opsiyonel.

```sql
-- BI Export: session granularity (attribution + touchpoints)
-- Parametreler: :site_id (uuid), :from_ts (timestamptz), :to_ts (timestamptz)
SELECT
    s.id AS session_id,
    s.created_at AS session_time,
    s.created_month,
    s.attribution_source,
    s.utm_source,
    s.utm_medium,
    s.utm_campaign,
    s.ads_network,
    s.gclid,
    s.wbraid,
    s.gbraid
FROM sessions s
WHERE s.site_id = :site_id
  AND s.created_at BETWEEN :from_ts AND :to_ts
ORDER BY s.created_at DESC;
```

**Not:** `sessions` partitioned; `created_at` üzerinden filtre partition pruning sağlayabilir (native range partition ile).

---

## 5. Performans İpuçları

| Öneri | Açıklama |
|-------|----------|
| Composite index | Yukarıdaki `idx_ocq_site_status_created` — BI export sorgularını hızlandırır. |
| Tarih aralığı limiti | Varsayılan `from` / `to` 90 gün; maksimum 365 gün (rate limit ile korunabilir) |
| `include_signals` | `false` iken marketing_signals JOIN atlanmalı (N+1 veya gereksiz JOIN maliyeti) |

---

## 6. EC Bridge (Enhanced Conversions Hazırlığı)

Export taslağında `c.phone_number` kolonu şimdiden mevcut. Phase 2'de:

- `offline_conversion_queue` tablosuna `hashed_email`, `hashed_phone_number`, `user_identifier_source` kolonları eklenecek.
- API response'ta `phone_number` yerine `hashed_phone` (veya boş) dönülecek.
- BI Export sadece sistem ID'leri ve skorlarla çalışacak; PII export edilmeyecek (Zero PII Risk).

---

## 7. Parametre Özeti

| Parametre | Tip | Zorunlu | Varsayılan | Açıklama |
|-----------|-----|---------|------------|----------|
| site_id | uuid | Evet | - | Hedef site |
| granularity | enum | Evet | - | `conversion`, `call`, `session` |
| from | ISO8601 | Evet | - | Başlangıç zamanı |
| to | ISO8601 | Evet | - | Bitiş zamanı |
| include_signals | boolean | Hayır | false | marketing_signals JOIN |
