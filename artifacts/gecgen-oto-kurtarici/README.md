# Gençgen Oto Kurtarıcı — SST entegrasyonu

Site: **Gençgen Oto Kurtarıcı** (`862314ce888d44b29aa222833e9b0af2`)  
Domain: `gecgenotokurtarici.com` (www normalize edilir)

## 1) Cloudflare Worker

`adsmantik-engine/wrangler.jsonc` içinde `SITE_CONFIG` ve `routes` güncellendi.

Deploy:

```bash
npm --prefix adsmantik-engine run deploy
```

### `OPS_CALL_EVENT_SECRETS` (birleştirerek güncelle)

Mevcut Worker secret JSON'una **yeni satırı ekleyin** (tüm dosyayı silmeyin):

```json
"862314ce888d44b29aa222833e9b0af2": "<artifacts/gecgen-oto-kurtarici/ops-call-event-secrets.json içindeki değer>"
```

Örnek (sadece bu site için patch dosyası):

```bash
cd adsmantik-engine
wrangler secret put OPS_CALL_EVENT_SECRETS
```

Yapıştırırken diğer `public_id` anahtarlarını koruyun.

## 2) Site embed (`core.js`)

`embed-snippet.html` dosyasını sitenin `<head>` veya layout'una ekleyin.

Güncel tracker kopyası: `artifacts/gecgen-oto-kurtarici/core.js` (`npm run tracker:build` ile üretilir).

## 3) Google Ads OCI

Script üretimi:

```bash
npm run build:google-ads-script -- --site=gecgen-oto-kurtarici
```

Google Ads Script Properties: `OPSMANTIK_API_KEY` = site `oci_api_key` (console'dan; repoya yazmayın).

## 4) Test

- Sitede `tel:` veya WhatsApp tıklaması
- Cloudflare Worker logları / OpsMantik dashboard etkinlikleri
