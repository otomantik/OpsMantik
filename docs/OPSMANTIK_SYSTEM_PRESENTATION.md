# OpsMantik Sistem Sunumu
## Matematik, Felsefe, Mimari

**Tarih:** 2026-02-25  
**Versiyon:** 1.0  
**Hedef Kitle:** Teknik ve iş ekibi

---

## 1. Executive Summary

OpsMantik, Google Ads Offline Conversion Import (OCI) için tasarlanmış bir **lead intelligence ve attribution platformu**dur. Sistemin temel felsefesi: **"Kill the Hybrid, Enforce the Seal"** — yani hibrit/gri modeller yerine, sadece operatör onaylı (mühürlenmiş) dönüşümlerin Google Ads'e gönderilmesi.

### Ana İlkeler

| İlke | Açıklama |
|------|----------|
| **Iron Seal** | Hiçbir kayıt operatör mühürlemeden Google Ads'e gönderilmez |
| **Identity Boundary** | Dış sistemler sadece `public_id` kullanır; UUID dışarıya sızdırılmaz |
| **Immutable Ledger** | Finansal kayıtlar değiştirilemez; hata durumunda yeni düzeltme kaydı |
| **Fast-Closer Bias** | Tıklamaya yakın sinyaller daha yüksek değer alır (zaman aşımı matematigi) |

---

## 2. Mimari Genel Bakış

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OpsMantik System Architecture                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  [Tracker / Pixel]  ──►  /api/sync, /api/call-event, /api/track/pv          │
│         │                           │                                        │
│         ▼                           ▼                                        │
│  ┌──────────────┐           ┌──────────────────────┐                        │
│  │ sessions     │           │ QStash / Worker       │                        │
│  │ events       │           │ call-event worker     │                        │
│  │ calls        │           └──────────┬───────────┘                        │
│  └──────┬───────┘                      │                                      │
│         │                              ▼                                      │
│         │                     ┌──────────────────────┐                        │
│         │                     │ offline_conversion_  │  Pipeline A (Seals)    │
│         │                     │ queue                │                        │
│         │                     └──────────┬───────────┘                        │
│         │                                │                                     │
│         │                     ┌──────────▼───────────┐                        │
│         │                     │ marketing_signals    │  Pipeline B (Signals)  │
│         │                     └──────────┬───────────┘                        │
│         │                                │                                     │
│         │                     ┌──────────▼───────────┐                        │
│         │                     │ Redis (pv:queue)     │  Pipeline C (PV)       │
│         │                     └──────────┬───────────┘                        │
│         │                                │                                     │
│         │                                ▼                                     │
│         │                     ┌──────────────────────┐                        │
│         │                     │ /api/oci/google-ads- │  Tri-Pipeline Merge    │
│         │                     │ export               │                        │
│         │                     └──────────┬───────────┘                        │
│         │                                │                                     │
│         │                                ▼                                     │
│         │                     ┌──────────────────────┐                        │
│         └────────────────────►│ Google Ads Script    │──► Google Ads API      │
│                               │ (UrlFetchApp)        │                        │
│                               └──────────┬───────────┘                        │
│                                          │                                     │
│                                          ▼                                     │
│                               ┌──────────────────────┐                        │
│                               │ /api/oci/ack         │  ACK (seal/signal/pv)  │
│                               └──────────────────────┘                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Matematik Modelleri

### 3.1 Lead Score (computeLeadScore)

**Kaynak:** `lib/security/scoring.ts`

Lead score, bir oturum veya aramadaki kullanıcı niyetini 0–100 arasında sayısal olarak ifade eder. Event kategorisi, aksiyon ve bağlam üzerinden hesaplanır.

| Kurallar | Puan |
|----------|------|
| **Kategori: conversion** | +50 |
| **Kategori: interaction** | +10 |
| **scroll_depth ≥ 50** | +10 |
| **scroll_depth ≥ 90** | +20 |
| **hover_intent** | +15 |
| **Referrer google içeriyorsa** | +5 |
| **Returning ad user** | +25 |
| **Cap** | max 100 |

**Formül (kavramsal):**

```
lead_score = min(
  (conversion ? 50 : 0) + (interaction ? 10 : 0) +
  (scroll_depth >= 50 ? 10 : 0) + (scroll_depth >= 90 ? 20 : 0) +
  (hover_intent ? 15 : 0) + (google_referrer ? 5 : 0) + (returning_ad ? 25 : 0),
  100
)
```

---

### 3.2 Predictive Value Engine (calculateExpectedValue)

**Kaynak:** `lib/valuation/predictive-engine.ts`

OCI için conversion value tahmini: AOV (Average Order Value) × intent stage weight.

| Intent Stage | Varsayılan Ağırlık | EV Formülü |
|--------------|--------------------|------------|
| sealed / won / purchase | 1.0 | AOV × 1.0 |
| qualified / real | 0.20 | AOV × 0.20 |
| pending / open | 0.02 | AOV × 0.02 |
| junk / lost | 0.0 | 0 |

**Formül:**

```
EV(action) = AOV × Weight(action)
AOV = site.default_aov ?? 100
Weight(action) = intent_weights[action] ?? DEFAULT_INTENT_WEIGHTS[action]
```

Örnek: AOV = 500 TRY, action = qualified → EV = 500 × 0.20 = **100 TRY**

---

### 3.3 MizanMantik — Zaman Aşımı Değer Modeli (calculateDecayedValue)

**Kaynak:** `lib/utils/mizan-mantik.ts`

**Felsefe:** Sinyal, tıklamadan ne kadar uzaktaysa o kadar değer kaybeder (Fast-Closer Bias).

| Bucket | Gün Aralığı | Çarpan | Formül |
|--------|-------------|--------|--------|
| **HOT** | 0–3 gün | 0.50 | baseValue × 0.50 |
| **WARM** | 4–10 gün | 0.25 | baseValue × 0.25 |
| **COLD** | > 10 gün | 0.10 | baseValue × 0.10 |

**Formül:**

```
elapsedMs = max(0, signalDate - clickDate)
days = ceil(elapsedMs / 86400000)

decayedValue = round(baseValue × multiplier)
  where multiplier = 0.50 if days ≤ 3
                   = 0.25 if 4 ≤ days ≤ 10
                   = 0.10 if days > 10
```

Örnek: baseValue = 1000 TRY, 2 gün sonra sinyal → **500 TRY** (HOT)

---

### 3.4 Conversion Value Seçim Önceliği (Export Route)

Export rotasında nihai `conversionValue` şu sırayla belirlenir:

1. **Queue (Seals):** `value_cents / 100` — operatör girişi veya OCI config
2. **Predictive Engine:** Queue değeri 0 ise → `calculateExpectedValue(aov, weights, action)`
3. **Signals:** `conversion_value` — MizanMantik ile hesaplanmış (DB’de)
4. **PV:** Sabit 0 (sadece volume sinyali)

---

## 4. Iron Seal Felsefesi

### 4.1 Neden "Mühür"?

- **Finansal sorumluluk:** Google Ads’e gönderilen her conversion reklam optimizasyonunu etkiler.
- **Hata toleransı:** Yanlış veya spekülatif veri gönderimi ROI’yi bozar.
- **Operatör kontrolü:** Sadece doğrulanmış, mühürlenmiş kayıtlar gönderilir.

### 4.2 Seal Status Modeli

| seal_status | Anlam | Dispatch |
|-------------|-------|----------|
| **unsealed** | Varsayılan; henüz doğrulanmadı | ❌ Asla gönderilmez |
| **sealed** | Operatör mühürledi | ✅ Dispatch edilebilir |

**Veritabanı:** `get_pending_conversions_for_worker` RPC yalnızca `seal_status = 'sealed'` kayıtlarını döner. Bu, SQL seviyesinde zorunlu kılınır.

### 4.3 Değiştirilemez Finansal Defter (Immutable Ledger)

- **revenue_snapshots:** APPEND-ONLY. UPDATE/DELETE tetikle tarafından engellenir.
- **provider_dispatches:** DELETE engellenir (audit trail).
- Düzeltme gerektiğinde yeni snapshot kaydı açılır; mevcut kayıt değiştirilmez.

---

## 5. Tri-Pipeline Modeli

### 5.1 Pipeline A — Seals (offline_conversion_queue)

- **Kaynak:** Operatör mühürlemesi sonrası enqueue.
- **ID formatı:** `seal_<uuid>`
- **ACK:** `offline_conversion_queue` → status=COMPLETED, uploaded_at=NOW

### 5.2 Pipeline B — Signals (marketing_signals)

- **Kaynak:** emitSignal (INTENT_CAPTURED, SEAL_PENDING, MEETING_BOOKED).
- **ID formatı:** `signal_<uuid>`
- **Değer:** MizanMantik ile hesaplanan `conversion_value`.
- **ACK:** dispatch_status=SENT, google_sent_at=NOW

### 5.3 Pipeline C — Page Views (Redis)

- **Kaynak:** `/api/track/pv` — gclid/wbraid/gbraid ile page view.
- **ID formatı:** `pv_<uuid>`
- **Storage:** `pv:queue:{siteId}` → LMOVE → `pv:processing:{siteId}`
- **ACK:** Redis DEL `pv:data:{id}`, LREM `pv:processing:{siteId}`

### 5.4 Pipeline Merge Mantığı

Export, üç pipeline’dan gelen kayıtları tek bir JSON dizisinde birleştirir. Sıralama `conversionTime`’a göre yapılır.

---

## 6. Identity Boundary

**Kural:** Dış sistemler (Google Ads Script, 3rd party) asla internal UUID kullanmaz.

| Ortam | Kimlik | Kullanım |
|-------|--------|----------|
| **Dış** | public_id (örn. 32-char hex) | Handshake, Script Properties |
| **İç** | UUID (sites.id) | DB ilişkileri, session token payload |

**Verify endpoint:** `siteId` UUID ise 400 döner (`IDENTITY_BOUNDARY`). Session token içinde UUID, dışarıya verilmez; token Bearer ile taşınır.

---

## 7. OCI Akışı (Handshake → Export → Upload → ACK)

```
1. Handshake:  POST /api/oci/v2/verify
   Body: { siteId: public_id }
   Headers: x-api-key
   Response: { session_token, expires_at }  (5 min TTL)

2. Export:     GET /api/oci/google-ads-export?siteId=...&markAsExported=true
   Headers: Authorization: Bearer <session_token>
   Response: [ { id, orderId, gclid, conversionName, conversionTime, conversionValue, ... }, ... ]

3. Upload:     (Google Ads Script — AdsApp.offlineConversionUploads)

4. ACK:        POST /api/oci/ack
   Body: { siteId, queueIds: ['seal_...', 'signal_...', 'pv_...'] }
   Headers: Authorization: Bearer <session_token>
   Response: { ok: true, updated: N, warnings?: { redis_cleanup_failed: [...] } }
```

---

## 8. Zaman ve Saat Dilimi

- **Depolama:** UTC (ISO 8601).
- **Google Ads formatı:** `yyyy-mm-dd hh:mm:ss+0300` (Türkiye saati).
- **Dönüşüm:** `TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000`; UTC timestamp + offset ile lokal saat üretilir.

---

## 9. Hata Toleransı ve Dayanıklılık

### 9.1 ACK Redis Hataları

- Her `pv_` ID için `redis.del` ve `redis.lrem` ayrı try/catch içinde.
- Başarısız ID’ler `failedRedisCleanups` listesine eklenir.
- Response: `{ ok: true, updated: N, warnings: { redis_cleanup_failed: ['pv_...'] } }`
- Sistem çökmez; istemci hangi temizliklerin yapılamadığını görür.

### 9.2 Rate Limiting

- OCI verify: 10 req/min, fail-closed
- OCI export: 10 req/min, fail-closed
- OCI ack: 30 req/min, fail-closed
- Track PV: 2000 req/min, fail-closed

### 9.3 Partitioning

- `oci_sync_method = 'script'` → Export/ACK script üzerinden
- `oci_sync_method = 'api'` → Backend API sync; script export reddedilir (400)

---

## 10. Veri Akışı Özeti

| Katman | Tablo / Kaynak | Matematik / Mantık |
|--------|----------------|--------------------|
| Tracker | events, sessions, calls | computeLeadScore, fingerprint match |
| Seal | offline_conversion_queue | value_cents veya calculateExpectedValue |
| Signal | marketing_signals | calculateDecayedValue (MizanMantik) |
| PV | Redis pv:queue | conversionValue: 0 (volume only) |
| Ledger | revenue_snapshots, provider_dispatches | Immutable append-only |

---

## 11. Özet Formüller (Cheat Sheet)

```
Lead Score     = min(Σ(category + action + context), 100)
EV             = AOV × Weight(intent_stage)
Decayed Value  = round(baseValue × multiplier(days))
  days         = ceil((signalDate - clickDate) / 86400000)
  multiplier   = 0.50 | 0.25 | 0.10  (HOT | WARM | COLD)
ConversionTime = formatTurkey(utcTimestamp + 3h)
```

---

## 12. Dosya Haritası

| Modül | Dosya |
|-------|-------|
| Lead Score | `lib/security/scoring.ts` |
| Predictive Value | `lib/valuation/predictive-engine.ts` |
| MizanMantik | `lib/utils/mizan-mantik.ts` |
| Signal Emitter | `lib/services/signal-emitter.ts` |
| OCI Verify | `app/api/oci/v2/verify/route.ts` |
| OCI Export | `app/api/oci/google-ads-export/route.ts` |
| OCI ACK | `app/api/oci/ack/route.ts` |
| Track PV | `app/api/track/pv/route.ts` |
| Primary Source (GCLID) | `lib/conversation/primary-source.ts` |

---

*Bu sunum OpsMantik v1.0.2-bulletproof mimarisine dayanmaktadır.*
