# Tracker script güncellemesi (CORS / intent düşmeme)

## Sorun
Eslamed (ve benzeri siteler) eski `core.js` cache’inden yüklenince tarayıcı `credentials: 'include'` ile istek atıyor; sunucu CORS’ta `Access-Control-Allow-Credentials` beklenen şekilde gelmeyince istek bloklanıyor. Sonuç: event yakalanıyor ama sync/call-event gitmiyor, intent ekrana düşmüyor (özellikle telefondan).

## Çözüm
Sitedeki script tag’inde **core.js** URL’ine **cache-busting** ekleyin: `?v=2`

### Eslamed için
Eslamed’deki mevcut script şuna benzer olabilir:
```html
<script defer src="https://console.opsmantik.com/assets/core.js" data-ops-site-id="..." data-api="https://console.opsmantik.com/api/sync"></script>
```

Şu şekilde güncelleyin:
```html
<script defer src="https://console.opsmantik.com/assets/core.js?v=4" data-ops-site-id="..." data-api="https://console.opsmantik.com/api/sync"></script>
```

Sadece `core.js` → `core.js?v=4` eklenmesi yeterli. Deploy sonrası sayfayı yenileyin (gerekirse hard refresh: Ctrl+Shift+R / Cache temizle). Yeni script ile sync/call-event CORS’a takılmadan gider, intent’ler hem masaüstü hem telefondan düşer.

### Genel
- Dashboard’dan kopyalanan yeni snippet’ler zaten `?v=2` içerir.
- Eski embed’i kullanan sitelerde script URL’ine `?v=2` eklenmesi önerilir.
- `/assets/core.js` için sunucu tarafında Cache-Control: max-age=60 ayarlı; `?v=2` olmasa bile ~1 dakika sonra yeni sürüm alınabilir.
