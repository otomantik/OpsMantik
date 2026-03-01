# GCLID İzleme ve Rome/Amsterdam Ghost Geo Audit

**Amaç:** GCLID akışını, Rome/Amsterdam ghost geo sorununu ve early-call riskini izlemek.

## 1. SQL Audit Dosyaları

| Dosya | İçerik |
|-------|--------|
| `oci_muratcan_gclid_audit.sql` | Muratcan: Ghost oranı, early-call latency, GCLID consistency |
| `oci_eslamed_muratcan_bugun_intent_durum.sql` | Eslamed + Muratcan: Bugünkü intent ve kuyruk durumu |

## 2. Geo Mismatch Sorgusu (Ghost oranı)

`sessions.city` Rome/Amsterdam iken `calls.gclid` dolu olan kayıt oranı — sorunun boyutunu ölçer.

```sql
-- Muratcan için (son 30 gün)
-- docs/runbooks/oci_muratcan_gclid_audit.sql Sorgu 1
```

**Yorum:** ghost_rate_pct yüksekse IP geo yanlış; ADS geo tercih edilmeli.

## 3. Latency Audit (Early Call)

`events.created_at` (ilk sync) ile `calls.matched_at` arasındaki fark.

- **Negatif:** Call sync'ten önce gelmiş — GCLID kaybı riski
- **< 5 sn:** Early call — session'a GCLID henüz yazılmamış olabilir

```sql
-- docs/runbooks/oci_muratcan_gclid_audit.sql Sorgu 2
```

**Yorum:** early_call_under_5s yüksekse process-call-event içinde early-call fix (session'a ADS geo yaz) gerekli.

## 4. GCLID Consistency (Call vs Session)

- **call_has_session_missing:** Call'da GCLID var, session'da yok — early call veya sync atlaması
- **session_has_call_missing:** Session'da var, call'da yok — worker/payload aktarımı hatası

```sql
-- docs/runbooks/oci_muratcan_gclid_audit.sql Sorgu 3
```

## 5. Google Ads Template Checklist

| Kontrol | Beklenen | Muratcan |
|---------|----------|----------|
| Final URL Suffix | `gclid={gclid}` veya ValueTrack | ? |
| Tracking template | `{lpurl}?gclid={gclid}&loc_physical_ms={loc_physical_ms}` | ? |
| Script embed | `data-ops-site-id` = site public_id | `28cf0aefaa074f5bb29e818a9d53b488` |

## 6. google_geo_targets Kontrolü

Muratcan'ın hedeflediği Türkiye illerinin tabloda olup olmadığı:

```sql
SELECT criteria_id, name, canonical_name, country_code, target_type
FROM google_geo_targets
WHERE country_code = 'TR'
  AND status = 'Active'
ORDER BY target_type, name
LIMIT 100;
```

**Yorum:** Tablo boş veya eksikse ADS geo çözümlemesi çalışmaz.

## 7. Regression Gate

Fix sonrası her deploy öncesi:

1. `oci_muratcan_gclid_audit.sql` Sorgu 1 — ghost_rate_pct düşük veya 0 olmalı
2. Sorgu 2 — early_call_under_5s kabul edilebilir seviyede olmalı
3. Sorgu 3 — call_has_session_missing azalmalı
