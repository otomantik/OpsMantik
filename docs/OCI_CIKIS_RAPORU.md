# OCI (Offline Conversion Import) Çıkış Akışı ve Eksikler Raporu

**Tarih:** 2026-02-25  
**Kapsam:** Seal → Google Ads OCI, worker’lar, script ve cron mantığı

---

## 1. OCI Akış Özeti

### Ana Akış (offline_conversion_queue)

```
Seal Call → enqueueSealConversion() → offline_conversion_queue (QUEUED)
                                         │
                    ┌────────────────────┴────────────────────┐
                    │                                         │
              oci_sync_method='api'                   oci_sync_method='script'
                    │                                         │
         process-offline-conversions              Google Ads Script
         cron (*/10 dk)                           (çek → yükle → ack)
                    │                                         │
         runner (mode: cron)                       GET google-ads-export
         → provider_credentials                    POST /api/oci/ack
         → Google Ads API (direkt)
```

### Paralel (Legacy): conversions tablosu

```
dispatch-conversions cron (*/2 dk) → conversion-worker
  → conversions tablosu (Iron Dome)
  → GOOGLE_ADS_CREDENTIALS (global env)
  → Google Ads API
```

---

## 2. Endpoint ve Worker Matrisi

| Endpoint | Tetikleyici | Rol |
|----------|-------------|-----|
| `POST /api/workers/google-ads-oci` | Manuel / QStash | offline_conversion_queue → Google Ads API (api modu siteler) |
| `GET /api/cron/process-offline-conversions` | Vercel Cron */10 | Aynı runner, cron modu (api siteler) |
| `GET /api/oci/google-ads-export` | Google Ads Script | Script modu: QUEUED/RETRY satırlarını çeker |
| `POST /api/oci/ack` | Google Ads Script | Yükleme sonrası PROCESSING → COMPLETED |
| `GET /api/cron/providers/recover-processing` | Vercel Cron */10 | PROCESSING’de takılı satırları RETRY’a alır |
| `GET /api/cron/sweep-unsent-conversions` | Vercel Cron */15 | Seal edilmiş ama kuyrukta olmayan call’ları kuyruğa ekler |
| `POST /api/cron/dispatch-conversions` | Vercel Cron */2 | `conversions` tablosu (Iron Dome, eski akış) |

---

## 3. Olası Eksikler ve Riskler

### 3.1 google-ads-oci worker Vercel cron’da yok

- **Durum:** `vercel.json` cron listesinde `/api/workers/google-ads-oci` yok.
- **Etki:** Bu worker sadece manuel (`npm run worker:google-ads-oci`) veya QStash ile tetiklenebiliyor.
- **Sonuç:** `process-offline-conversions` zaten api siteleri için aynı işi yapıyor; google-ads-oci ayrı bir tetikleyici olarak kullanılmıyorsa büyük risk değil.
- **Öneri:** `oci_sync_method='api'` siteler için yalnızca `process-offline-conversions` kullanılıyorsa net; QStash/manuel tetikleme gerekiyorsa dokümante edilmeli.

### 3.2 Script sadece tek site (Muratcan AKÜ)

- **Durum:** `scripts/google-ads-oci/GoogleAdsScript.js` içinde `siteId` sabit: `c644fff7-9d7a-440d-b9bf-99f3a0f86073`.
- **Etki:** Poyraz Antika, Yapıozman Danışmalık vb. script modunda olsalar bile bu script ile çalışmaz.
- **Öneri:** Script Properties’ten `OPSMANTIK_SITE_ID` alınmalı; site başına ayrı script instance veya loop ile multi-site desteklenmeli.

### 3.3 OCI_API_KEY vs OCI_API_KEYS

- **export-batch:** `OCI_API_KEYS` (siteId:key formatında) destekliyor; yoksa `OCI_API_KEY` fallback.
- **ack:** Sadece `OCI_API_KEY` kullanıyor; `OCI_API_KEYS` yok.
- **google-ads-export:** Sadece `OCI_API_KEY`.
- **Etki:** Çok siteli script senaryosunda ack için tek key kullanılıyor; site bazlı key politikası tutarlı değil.
- **Öneri:** ack endpoint’inde de `OCI_API_KEYS` ile site-scoped auth eklenmeli veya “tek key tüm siteler” kararı netleştirilmeli.

### 3.4 oci_sync_method varsayılanı

- **Durum:** `sites.oci_sync_method` default: `script`.
- **Etki:** Yeni siteler script modunda; `list_offline_conversion_groups` ve `claim_offline_conversion_jobs_v2` sadece `oci_sync_method='api'` satırları claim ediyor.
- **Sonuç:** Script modundaki siteler `process-offline-conversions` tarafından işlenmez; sadece Google Ads Script ile çalışır.
- **Kontrol:** Poyraz Antika / Yapıozman için `oci_sync_method` değeri kontrol edilmeli (api mi script mi).

### 3.5 Provider credentials

- **api modu:** `provider_credentials` tablosundan, site bazlı, şifreli.
- **Script modu:** Script kendi OAuth ile çalışır; export endpoint sadece JSON verir, upload Script’te.
- **Risk:** `provider_credentials` eksik veya decrypt hatası → batch FAILED, `last_error: 'Credentials missing or decryption failed'`.

### 3.6 recover-processing süresi

- **Durum:** `min_age_minutes=15` (default); PROCESSING’de 15 dk kalan satırlar RETRY’a alınıyor.
- **Etki:** Script ack vermezse veya uzun süre çalışmazsa 15 dk sonra satırlar tekrar denenecek.
- **Not:** `recover_stuck_offline_conversion_jobs` RPC’si `oci_sync_method='api'` filtresiyle güncellenmiş mi kontrol edilmeli (20260309000000 migration).

### 3.7 conversions vs offline_conversion_queue

- **İki farklı tablo:** `conversions` (Iron Dome) ve `offline_conversion_queue` (Seal → OCI).
- **dispatch-conversions:** Sadece `conversions` tablosu ile çalışıyor; `offline_conversion_queue`’ya dokunmuyor.
- **Etki:** Seal akışı `offline_conversion_queue` kullanıyorsa, `dispatch-conversions` bu akıştan bağımsız. İki sistem paralel çalışıyorsa netleştirilmesi iyi olur.

### 3.8 sweep-unsent-conversions kapsamı

- **Amaç:** `oci_status='sealed'` olup `offline_conversion_queue`’da olmayan call’ları bulup `enqueueSealConversion` ile kuyruğa eklemek.
- **Sınır:** Son 7 gün, run başına max 500.
- **Eksik:** `enqueueSealConversion` gclid/wbraid/gbraid, marketing consent ve star threshold kontrolü yapıyor; bu nedenle “orphan” olan her call enqueue edilemeyebilir.
- **Öneri:** Skip reason’ların loglanması veya raporlanması (no_click_id, marketing_consent_required, star_below_threshold vb.) işe yarar.

---

## 4. Cron Zamanlamaları (vercel.json)

| Cron | Schedule | Açıklama |
|------|----------|----------|
| process-offline-conversions | */10 | offline_conversion_queue (api siteler) → Google Ads |
| providers/recover-processing | */10 | PROCESSING’de takılı satırları RETRY’a alır |
| sweep-unsent-conversions | */15 | Seal edilmiş ama kuyrukta olmayan call’ları kuyruğa ekler |
| dispatch-conversions | */2 | conversions tablosu (Iron Dome) |

---

## 5. Yapılacaklar Özeti

1. **Script multi-site:** `GoogleAdsScript.js` site listesi veya Script Properties ile çoklu site desteklemeli.
2. **ack OCI_API_KEYS:** `POST /api/oci/ack` site-scoped key desteği eklenmeli veya tek key politikası dokümante edilmeli.
3. **oci_sync_method kontrolü:** Poyraz Antika ve Yapıozman için `api` mi `script` mi kullanıldığı doğrulanmalı.
4. **provider_credentials:** Api modundaki siteler için credential’ların varlığı ve decrypt edilebildiği kontrol edilmeli.
5. **google-ads-oci cron:** Gerekirse `vercel.json`’a eklenebilir; fakat `process-offline-conversions` ile çakışma/çift işlem riski değerlendirilmeli.

---

## 6. Hızlı Kontrol Sorguları

```sql
-- oci_sync_method durumu
SELECT id, domain, oci_sync_method FROM sites WHERE domain ILIKE '%poyraz%' OR domain ILIKE '%yapiozman%';

-- Kuyruk durumu (site bazlı)
SELECT site_id, provider_key, status, COUNT(*) 
FROM offline_conversion_queue 
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY site_id, provider_key, status;
```
