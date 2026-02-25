# Google Ads — Günlük Harcama Webhook (V2)

Eslamed (ve isteğe bağlı diğer tenant’lar) için Google Ads kampanya harcamasını OpsMantik’e saatlik gönderen script. Sadece **bugünün** verisi çekilir; webhook idempotent upsert yapar.

---

## ADIM 1: Cephaneyi topla

Script’i yapıştırmadan önce elinde şu 3 bilgi hazır olsun:

| Bilgi | Açıklama | Eslamed için değer |
|--------|----------|---------------------|
| **WEBHOOK_URL** | OpsMantik backend adresi | `https://console.opsmantik.com/api/webhooks/google-spend` (test için ngrok: `https://xxx.ngrok.io/api/webhooks/google-spend`) |
| **SECRET_TOKEN** | Webhook’u koruyan gizli şifre | Ürettiğin secret (aşağıda “Secret” bölümüne bak) |
| **SITE_ID** | OpsMantik `sites` tablosundaki site UUID | `b1264552-c859-40cb-a3fb-0ba057afd070` (Eslamed) |

**Secret üretmek (tek seferlik):**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Örnek çıktı: `5ScWmCqUNE6-0pGh1sdZxFo5u5CwRMNqfWAFiavGxDw`  
Bu değeri **hem Vercel’de hem script’te** aynen kullanacaksın.

---

## ADIM 2: Vercel’de ne yazacaksın?

1. Vercel → projeyi seç → **Settings** → **Environment Variables**.
2. Yeni değişken ekle:
   - **Name:** `GOOGLE_SPEND_WEBHOOK_SECRET`
   - **Value:** Ürettiğin secret (örn. `5ScWmCqUNE6-0pGh1sdZxFo5u5CwRMNqfWAFiavGxDw`).
   - **Environment:** Production (ve istersen Preview) işaretle.
3. **Save** → gerekirse redeploy.

Başka bir şey yapma; Vercel’de cron vs. yok. Zamanlama Google Ads tarafında saatlik tetikleyici ile.

---

## ADIM 3: Script’te ne yazacaksın?

`scripts/google-ads-spend/GoogleAdsScript.js` dosyasını Google Ads Script editörüne yapıştır. En üstteki 3 satırı kontrol et:

```javascript
var WEBHOOK_URL = "https://console.opsmantik.com/api/webhooks/google-spend";
var SECRET_TOKEN = "BURAYA_GIZLI_SIFRE_GELECEK";  // ← Vercel’e yazdığın değerin AYNISI
var SITE_ID = "b1264552-c859-40cb-a3fb-0ba057afd070";  // Eslamed (zaten dolu)
```

- **WEBHOOK_URL:** Production için aynen bırak; test için ngrok URL’i yaz.
- **SECRET_TOKEN:** Vercel’e yazdığın `GOOGLE_SPEND_WEBHOOK_SECRET` değerini buraya **aynı şekilde** yapıştır.
- **SITE_ID:** Eslamed için `b1264552-c859-40cb-a3fb-0ba057afd070` (değiştirme).

Özet: **Vercel’deki `GOOGLE_SPEND_WEBHOOK_SECRET` = Script’teki `SECRET_TOKEN`** olmalı.

---

## ADIM 4: Eslamed Google Ads’e script’i ekleme

1. Eslamed’in Google Ads hesabını aç.
2. **Araçlar ve Ayarlar** (Tools & Settings) → **Toplu İşlemler** → **Komut Dosyaları** (Scripts).
3. **+ Yeni Komut Dosyası** → açılan editördeki tüm kodu sil.
4. Bu repo’daki `scripts/google-ads-spend/GoogleAdsScript.js` içeriğini yapıştır.
5. **SECRET_TOKEN** satırını Adım 1’deki secret ile doldur (Vercel’deki ile aynı).
6. **Kaydet** → **Tetikleyiciler** (Triggers) → **Saatlik** seç (örn. her saat başı).

---

## Özet tablo (karışmasın diye)

| Nerede | Ne yazıyorsun |
|--------|----------------|
| **Vercel** → Environment Variables | **Name:** `GOOGLE_SPEND_WEBHOOK_SECRET` **Value:** `5ScWmCqUNE6-0pGh1sdZxFo5u5CwRMNqfWAFiavGxDw` (veya senin ürettiğin secret) |
| **Google Ads Script** → `SECRET_TOKEN` | **Aynı değer** (yukarıdaki Value) |
| **Google Ads Script** → `SITE_ID` | `b1264552-c859-40cb-a3fb-0ba057afd070` (Eslamed, script’te zaten var) |
| **Google Ads Script** → `WEBHOOK_URL` | `https://console.opsmantik.com/api/webhooks/google-spend` (script’te zaten var) |

---

## Repo’daki dosyalar

| Dosya | Açıklama |
|-------|----------|
| `scripts/google-ads-spend/GoogleAdsScript.js` | Google Ads’e yapıştırılacak V2 script (sadece bugünün verisi). |
| `scripts/google-ads-oci/GoogleAdsScript.js` | OCI (offline conversion) için ayrı script; spend ile karıştırma. |
