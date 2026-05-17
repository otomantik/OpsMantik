# SpotBizde Lastik Entegrasyon Planı

Bu belge, `spotbizdelastik.com` sitesinin OpsMantik sistemine entegrasyonu için gerekli adımları içerir.

## 1. Cloudflare Worker Güncellemesi

Cloudflare Worker (`adsmantik-engine`) konfigürasyonu güncellendi. Şimdi yeni sitenin secret anahtarını yüklemeniz gerekiyor.

### Secret Güncelleme Komutu:
`adsmantik-engine` dizininde aşağıdaki komutu çalıştırın:

```bash
wrangler secret put OPS_CALL_EVENT_SECRETS < artifacts/spotbizde-lastik/ops-call-event-secrets.json
```

*Not: Eğer tüm siteleri içeren bir secret listesi kullanıyorsanız, bu JSON dosyasını mevcut olanla birleştirmeniz gerekebilir.*

## 2. Site Entegrasyonu (Astro / HTML)

Aşağıdaki scripti sitenin `<head>` bölümüne veya `Layout.astro` dosyasının içine gömün.

### Embed Snippet:
```html
<script
  defer
  src="https://spotbizdelastik.com/opsmantik/core.js?v=7"
  data-ops-site-id="00699ff719394611b224a05ffab0675d"
  data-ops-consent="analytics,marketing"
  data-api="https://spotbizdelastik.com/opsmantik/sync"
  data-ops-proxy-url="https://spotbizdelastik.com/opsmantik/call-event"
></script>
```

## 3. Çalışma Mantığı

1. **core.js**: Tarayıcıda çalışır, etkinlikleri (telefon tıklaması, form gönderimi vb.) yakalar.
2. **Worker Proxy**: Etkinlikler `/opsmantik/sync` ve `/opsmantik/call-event` üzerinden Cloudflare Worker'a gönderilir.
3. **Backend Forwarding**: Worker, gelen etkinlikleri OpsMantik backend sistemine (console.opsmantik.com) güvenli bir şekilde iletir.

## 4. Test Etme

Entegrasyon tamamlandıktan sonra:
- Sitede bir telefon numarasına tıklayın.
- Cloudflare Worker loglarını veya OpsMantik Dashboard üzerindeki etkinlikleri kontrol edin.
