# OpsMantik Probe — Gemini'ye Verilecek Entegrasyon Briefing

Bu dokümanı Android Studio'daki Gemini'ye kopyala-yapıştır yap. Entegrasyon testi ve API sözleşmeleri için kullan.

---

## 1. Test Kimlik Bilgileri (Credentials)

Backend'den alacakların:

| Alan | Değer | Kaynak |
|------|-------|--------|
| **siteId** | `ea336d7749434c1c8549e3512ee963ec` | Antalya Golf Shop public_id (sabit test site) |
| **accessToken** | JWT string | Backend: `npm run probe:token` komutu stdout'a yazar |
| **baseUrl** | `https://console.opsmantik.com` (prod) veya `http://localhost:3000` (dev) | Ortama göre |

**accessToken alma (Backend tarafı):**
```
npm run probe:token
```
Çıktıyı güvenli kanal ile Android ekibine ilet.

---

## 2. API Endpointleri ve Sözleşmeleri

### 2.1 Cihaz Kaydı — POST /api/probe/register

**Auth:** Bearer token (Authorization: Bearer &lt;accessToken&gt;)

**Request:**
```json
{
  "siteId": "ea336d7749434c1c8549e3512ee963ec",
  "deviceId": "android_device_unique_id",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\nMIIBIjAN...\n-----END PUBLIC KEY-----"
}
```

**publicKeyPem formatı (KRİTİK):** PEM olmalı. Sadece Base64 değil.
```kotlin
fun getPublicKeyPem(): String {
    val base64 = Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP)
    return "-----BEGIN PUBLIC KEY-----\n$base64\n-----END PUBLIC KEY-----"
}
```

**Response:** 200 OK — `{ "registered": true, "siteId": "uuid" }`

---

### 2.2 V4 Intent (Quality Score) — POST /api/intents/status

**Auth:** Header'lar (Bearer yok — cihaz imzası kullanılır)
- `X-Ops-Site-Id`: siteId (public_id veya UUID)
- `X-Ops-Device-Id`: deviceId

**Request:**
```json
{
  "idempotencyKey": "V4_INTENT:+905321234567:167888640",
  "phoneNumber": "+905321234567",
  "qualityScore": 4.0,
  "calibratedIntentValue": 280.0,
  "timestamp": 1678886412345,
  "signature": "BASE64_ENCODED_ECDSA_SIGNATURE"
}
```

**İmza:** `{ idempotencyKey, phoneNumber, qualityScore, calibratedIntentValue, timestamp }` objesinin **canonical JSON** (anahtarlar alfabetik sırada, boşluksuz) hâlinin ECDSA-SHA256 imzası. `signature` alanı imzaya dahil edilmez.

**Response:** 202 Accepted — `{ "accepted": true, "callId": "uuid" }`  
**409 Conflict:** idempotencyKey daha önce işlendi.

---

### 2.3 By-Phone Lookup — GET /api/sites/{siteId}/calls/by-phone?phone=+905...

**Auth:** Bearer token

**Örnek:** `GET /api/sites/ea336d7749434c1c8549e3512ee963ec/calls/by-phone?phone=%2B905321234567`

**Response 200:**
```json
{
  "callId": "uuid",
  "highestStage": "V3 - Qualified Lead",
  "merchantInsight": "Spent 5 mins on 'Premium Package' page",
  "predictedLtv": 750.50,
  "lastContact": "2026-03-09T10:00:00Z"
}
```

**404:** Numara bulunamadı.

---

### 2.4 Seal (V5 Demir Mühür) — POST /api/calls/{callId}/seal

**Auth:** Header `X-Ops-Device-Id` + body'de `signature` (Probe path)

**Request:**
```json
{
  "saleAmount": 4500.00,
  "currency": "TRY",
  "merchantNotes": "2 yıllık paket anlaşıldı.",
  "timestamp": 1678886912345,
  "signature": "BASE64_ENCODED_ECDSA_SIGNATURE"
}
```

**İmza:** `{ callId, saleAmount, currency, merchantNotes, timestamp }` objesinin canonical JSON imzası.

**Response 200:** `{ "success": true, "call": { ... } }`

---

## 3. Akış Sırası (Entegrasyon Testi)

1. **Cihaz Kaydı:** POST /api/probe/register (Bearer + publicKeyPem) → probe_devices tablosuna yazılır
2. **V4 Intent:** POST /api/intents/status (X-Ops-Site-Id, X-Ops-Device-Id, imzalı body) → call_funnel_ledger'a V4_INTENT eklenir
3. **By-Phone:** GET /api/sites/{siteId}/calls/by-phone?phone=... (Bearer) → Çalmadan önce HUD için
4. **Seal:** POST /api/calls/{callId}/seal (X-Ops-Device-Id, imzalı body) → Satış onayı

---

## 4. Önemli Notlar

- **Canonical JSON:** İmza öncesi obje `JSON.stringify(sortedKeys)` ile üretilmeli — anahtarlar alfabetik sırada.
- **publicKeyPem:** `-----BEGIN PUBLIC KEY-----` ve `-----END PUBLIC KEY-----` satırları olmalı. Sadece Base64 gönderme.
- **deviceId:** Android: `Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)` — benzersiz ve sabit kalmalı.
