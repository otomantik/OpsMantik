# Muratcan Google Ads Script (Quantum) — İnceleme

**Script:** Muratcan-OCI-Quantum.js (Google Ads Script Editor’da çalışan)  
**Backend:** `app/api/oci/` (v2/verify, google-ads-export, ack, ack-failed)

---

## Uyumlu / Doğru Olanlar

| Konu | Durum |
|------|--------|
| **Site ID** | `public_id` (28cf0aef...) kullanılıyor; verify ve export public_id kabul ediyor, UUID reddediliyor. ✅ |
| **Verify** | `x-api-key` + body `siteId` (public_id); backend `sites.oci_api_key` ile doğruluyor. ✅ |
| **conversionTime** | Backend `formatGoogleAdsTimeOrNull` → `yyyy-MM-dd HH:mm:ss±HHmm` (4 hane, virgülsüz). Script regex `[+-]\d{4}$` ile uyumlu. ✅ |
| **ACK id formatı** | Export `id: 'seal_' + row.id` döndürüyor; script aynı `id` ile ack/ack-failed gönderiyor; backend `seal_` ön ekini kaldırıp queue UUID ile güncelliyor. ✅ |
| **pendingConfirmation** | Script `sendAck(..., true)` kullanıyor; backend `UPLOADED` yapıyor. ✅ |
| **Conversion name** | `OpsMantik_V5_DEMIR_MUHUR` — backend `OPSMANTIK_CONVERSION_NAMES.V5_SEAL` ile aynı. ✅ |
| **Click ID önceliği** | Script `gclid \|\| wbraid \|\| gbraid`; backend ile aynı sıra. ✅ |
| **markAsExported** | `?markAsExported=true` ile export; claim RPC çağrılıyor. ✅ |

---

## Dikkat / Risk

### 1. API key script içinde düz metin (güvenlik)

```javascript
var MURATCAN_API_KEY = '3a1a48f946a1f42c...';
```

- Script Properties öncelikli; yine de repo veya kopyada key görünür.
- **Öneri:** Varsayılanı kaldır veya boş bırak; sadece Script Properties (`OPSMANTIK_API_KEY`) kullan. Key’i `node scripts/get-muratcan-credentials.mjs` ile alıp sadece Script Properties’e yapıştırın.

### 2. Order ID 64 karaktere kesiliyor (çakışma riski)

```javascript
var orderId = String(orderIdRaw).substring(0, 64);  // Google Ads Order ID max 64 karakter
```

- Backend `buildOrderId` 128 karaktere kadar üretebiliyor; export bu değeri döndürüyor.
- Script 64’e kesiyor. İki farklı dönüşümün orderId’sinin ilk 64 karakteri aynı olursa Google tek kayıt sayar (dedup), biri kaybolur.
- **Öneri:** Google Ads CSV “Order ID” limitini kontrol edin. Limit 128 ise script’te `substring(0, 128)` veya limiti kaldırın. Limit gerçekten 64 ise backend’de script path için 64 karakterlik orderId üretmek daha güvenli (çakışma backend’de yönetilir).

### 3. Muratcan = Worker (api) ise bu script çalışmamalı

- Muratcan için `oci_sync_method = 'api'` yapıldıysa kuyruk **Worker** tarafından işlenir.
- Bu script aynı site’ı da çekmemeli (Phase 3 SOP): Script Properties’ten Muratcan `public_id` veya site listesinden bu site kaldırılmalı.
- Script’te Muratcan varsayılanları “tek site” deploy için; canlıda tek kanal (ya script ya worker) kullanın.

---

## Opsiyonel İyileştirmeler

- **Hata mesajları:** `sendAckFailed` sonrası script log’ta `updated` sayısı yok; backend JSON’da `updated` dönüyor. İsterseniz yanıtı parse edip loglayabilirsiniz.
- **Google Click ID kolonu:** AdsApp CSV’de tek “Google Click ID” kolonu kullanıyorsunuz; gclid/wbraid/gbraid için Google dokümantasyonunda farklı kolon önerisi varsa (ör. iOS) ileride ayrı kolon eklenebilir. Şu an tek kolon yaygın kullanım.

---

## Özet

- Backend API ile **verify, export, ack, ack-failed** ve veri formatları **uyumlu**.
- **Yapılması iyi olanlar:** (1) API key’i script içinden kaldırıp sadece Script Properties kullanmak, (2) Order ID 64/128 limitini netleştirip çakışmayı önlemek, (3) Muratcan Worker’a geçtiyse bu script’te Muratcan’ı kapatmak (Phase 3 SOP).
