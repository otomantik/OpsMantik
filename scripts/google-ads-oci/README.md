# Google Ads OCI Script (OpsMantik Exit Valve)

**Eslamed (eslamed.com)** için yapılandırıldı.

## Ne yapar?

1. OpsMantik’ten **hazır dönüşüm listesini** alır: `GET https://console.opsmantik.com/api/oci/google-ads-export?siteId=81d957f3c7534f53b12ff305f9f07ae7&markAsExported=true`
2. Gelen kayıtları **Google Ads Offline Conversion** bulk upload ile yükler.
3. `markAsExported=true` sayesinde aynı kayıtlar bir daha dönmez.

## Google Ads’te yapılacaklar

1. **Script’i ekle:** Araçlar → Toplu işlemler → Scripts → Yeni script. `GoogleAdsScript.js` içeriğini yapıştır.
2. **Dönüşüm adı:** Google Ads’te bir “Offline / Import” dönüşüm aksiyonu oluşturun; adı **“Sealed Lead”** olsun (veya sunucuda `OCI_CONVERSION_NAME` ile aynı).
3. **Çalıştır:** Önce Önizleme/Çalıştır ile test edin; log’da “0 records” veya “applied X conversions” görünür.
4. **Zamanlama:** Script’e tetikleyici ekleyin (örn. günde 2–4 kez).

## Değerler (Eslamed)

| Ayar        | Değer |
|------------|--------|
| Site ID    | `81d957f3c7534f53b12ff305f9f07ae7` |
| Export URL | `https://console.opsmantik.com/api/oci/google-ads-export` |
| API Key    | `.env.local` → `OCI_API_KEY` (script içinde varsayılan var) |

Farklı bir site için `GoogleAdsScript.js` içindeki `siteId` ve gerekirse `exportUrl` / `apiKey` satırlarını değiştirin.
