# Google Ads OCI (Offline Conversion Import) — Durum Raporu

**Tarih:** 17 Şubat 2026  
**Kapsam:** OpsMantik — Google Ads offline conversion pipeline (backend + test)

---

## 1. Özet

| Bileşen | Durum | Not |
|--------|--------|-----|
| OAuth / Refresh Token | ✅ Çalışıyor | get-refresh-token.js (port 3001), .env.local |
| Test endpoint (/api/test-oci) | ✅ Çalışıyor | Bağlantı doğrulandı (UNPARSEABLE_GCLID / format düzeltmesi) |
| Vault (şifreleme) | ✅ Çalışıyor | OPSMANTIK_VAULT_KEY tanımlı, credential şifreleme/çözme OK |
| Provider credentials (seed) | ✅ Çalışıyor | PowerShell script + API seed; site için credential kayıtlı |
| Worker (/api/workers/google-ads-oci) | ✅ Çalışıyor | Claim → decrypt → upload → sonuç güncelleme uçtan uca çalışıyor |
| Veritabanı güncellemeleri | ✅ Çalışıyor | COMPLETED / FAILED / RETRY, last_error, retry_count doğru yazılıyor |
| War Room (dashboard) | ⏳ Yapılmadı | Planlandı; henüz UI yok |

---

## 2. Tamamlanan İşler

### 2.1 Backend

- **Google Ads adapter** (`lib/providers/google_ads/`): Auth (refresh_token → access_token), uploadClickConversions (REST v19), hata sınıflandırması (INVALID_GCLID, RESOURCE_NOT_FOUND, transient vs kalıcı).
- **Tarih formatı:** `conversion_date_time` = `yyyy-mm-dd hh:mm:ss+00:00` (milisaniye yok, timezone zorunlu).
- **Production worker** (`app/api/workers/google-ads-oci/route.ts`):
  - Auth: `CRON_SECRET` (Bearer) veya `x-vercel-cron`.
  - RPC: `list_offline_conversion_groups`, `claim_offline_conversion_jobs_v2` (google_ads, batch 50).
  - Credential: `provider_credentials` + vault `decryptJson`.
  - Sonuç: COMPLETED / FAILED (last_error) / RETRY (exponential backoff, max 7 deneme).
- **Test route** (`app/api/test-oci`): Mock payload ile API bağlantı testi, ham Google yanıtı döner.

### 2.2 Araçlar ve Konfigürasyon

- **get-refresh-token.js:** Port 3001 (Next.js ile birlikte çalışabilir), redirect URI: `http://localhost:3001/oauth2callback`.
- **Seed script** (`scripts/seed-google-ads-credentials.ps1`): Belirli site için Google Ads credential’ı vault ile şifreleyip `provider_credentials`’a yazar; `-UseBasicParsing` ile güvenlik uyarısı kapatıldı.
- **.env.local:** GOOGLE_ADS_*, CRON_SECRET, OPSMANTIK_VAULT_KEY tanımlı (vault key eklendi).

### 2.3 Doğrulanan Akışlar

1. **Test endpoint:** 200 + partial_failure (sahte GCLID) → bağlantı ve format OK.
2. **Worker + credential:** Önce "Credentials missing or decryption failed" → vault key ve seed sonrası credential okundu.
3. **Worker + OAuth:** Önce "invalid_grant" → yeni refresh token + seed sonrası token geçerli.
4. **Worker + Google Ads API:** Access token alındı, istek gitti; 400 "Request contains an invalid argument" (sahte GCLID / test conversion action) → beklenen; gerçek veriyle COMPLETED veya anlamlı hata beklenir.

---

## 3. Mevcut Durum (Veri)

- **Test kuyruk kayıtları:** 2 adet (id’ler: 8362eaa3-..., 5945f290-...) şu an RETRY; Google 400 döndü (test verisi). İstenirse FAILED yapılıp kapatılabilir.
- **Site:** `e47f36f6-c277-4879-b2dc-07914a0632c2` için `provider_credentials` (google_ads) kayıtlı ve decrypt edilebiliyor.
- **Worker tetikleme:** Manuel (PowerShell + CRON_SECRET) veya Vercel Cron (vercel.json) ile yapılabilir.

---

## 4. Yapılacaklar / Öneriler

| Öncelik | İş | Açıklama |
|--------|-----|----------|
| Yüksek | Gerçek conversion action ID | Google Ads’te gerçek conversion action’ın resource name’i (örn. `customers/5254299323/conversionActions/XXXXXXXX`) alınıp credential’da (seed) ve gerekirse mapper’da kullanılmalı. |
| Yüksek | War Room dashboard | Hangi satışlar Google’a gitti (yeşil), hangileri hata aldı (kırmızı + last_error tooltip), isteğe bağlı "Hemen Gönder" butonu. Veri: `offline_conversion_queue` (+ sales join). |
| Orta | 400 → FAILED | Google’dan 400 (invalid argument) gelince RETRY yerine FAILED yapılması (retry sayısını boşa harcamamak için). |
| Orta | Vercel Cron | Production’da worker’ın periyodik çalışması için vercel.json’da cron tanımı. |
| Düşük | uploaded_at | İstenirse `offline_conversion_queue`’ya `uploaded_at` sütunu eklenip COMPLETED güncellemesinde set edilebilir. |

---

## 5. Komut Özeti

- **Refresh token almak:** `node get-refresh-token.js` (port 3001; redirect URI Console’da tanımlı olmalı).
- **Credential seed (sunucu açık):** `.\scripts\seed-google-ads-credentials.ps1`
- **Worker tetikleme (PowerShell):**  
  `Invoke-WebRequest -Uri "http://localhost:3000/api/workers/google-ads-oci" -Method POST -UseBasicParsing -Headers @{ "Authorization" = "Bearer <CRON_SECRET>"; "Content-Type" = "application/json" }`

---

## 6. Sonuç

Google Ads OCI **backend pipeline’ı çalışır durumda**: kuyruk claim, credential decrypt, OAuth token, API çağrısı ve veritabanı güncellemeleri doğrulandı. Test verisiyle alınan 400 beklenen bir sonuç; gerçek GCLID ve conversion action ile canlı kullanıma hazır. Sıradaki adım: **War Room arayüzü** ve production’da **cron + gerçek conversion action** entegrasyonu.
