# Google Ads OCI Script (OpsMantik Exit Valve)

**Eslamed (eslamed.com)** için hazır script: `Eslamed-OCI-Quantum.js`

## Ne yapar?

1. OpsMantik'ten **hazır dönüşüm listesini** alır: `GET .../api/oci/google-ads-export?siteId=...&markAsExported=true`
2. Gelen kayıtları **Google Ads Offline Conversion** bulk upload ile yükler.
3. `markAsExported=true` ile yüklenen kayıtlar tekrar gelmez; ACK ile backend durumu güncellenir.

## Eslamed Kurulumu

1. **Script ekle:** Google Ads → Araçlar → Toplu işlemler → Scripts → Yeni script.
2. `Eslamed-OCI-Quantum.js` içeriğini kopyalayıp yapıştırın.
3. **Script Properties** (Project Settings → Script Properties):
   | Key | Value |
   |-----|-------|
   | `OPSMANTIK_SITE_ID` | Eslamed public_id (OpsMantik Console'dan) |
   | `OPSMANTIK_API_KEY` | OpsMantik OCI API key |
   | `OPSMANTIK_BASE_URL` | `https://console.opsmantik.com` (opsiyonel) |
4. **Dönüşüm adları:** Google Ads'te Offline Conversion aksiyonları oluşturun: `OpsMantik_V1_Nabiz`, `OpsMantik_V2_Ilk_Temas`, `OpsMantik_V3_Nitelikli_Gorusme`, `OpsMantik_V4_Sicak_Teklif`, `OpsMantik_V5_DEMIR_MUHUR`
5. **Test:** Önce Önizleme ile çalıştırın; logda "0 records" veya "Yuklendi=X" görünür.
6. **Zamanlama:** Tetikleyici ekleyin (örn. günde 2–4 kez).

## Diğer siteler

`GoogleAdsScript.js` jenerik versiyondur; aynı Script Properties ile herhangi bir site için kullanılabilir. Sadece `OPSMANTIK_SITE_ID` değerini ilgili sitenin public_id'si ile değiştirin.
