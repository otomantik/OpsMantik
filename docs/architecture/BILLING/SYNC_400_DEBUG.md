# Sync 400 — Heartbeat / event hatası nasıl çözülür

Tarayıcıda "Failed to load resource: 400" görüyorsan, istek `/api/sync`'e gidiyor ve sunucu 400 dönüyor.

## 1) Nedenini bul

**DevTools → Network** aç, başarısız olan **sync** isteğine tıkla:

- **Response** sekmesi: JSON gövdede `code` alanına bak.
- **Response Headers**: `X-OpsMantik-Error-Code` değerine bak.

| code / header | Anlamı | Ne yapmalı |
|---------------|--------|------------|
| `site_not_found` | Gönderilen `s` (site_id) veritabanında yok veya eşleşmiyor | Sitenin `public_id`'si ile tracker’daki site id aynı mı kontrol et. |
| `missing_site_or_url` | Gönderide `s` veya hem `url` hem `u` eksik/geçersiz | Tracker’ın `s` + `url`/`u` gönderdiğinden emin ol; sayfa adresi geçerli mi bak. |
| `invalid_json` | Body JSON değil veya parse hatası | Tracker/beacon tarafında gönderilen body’yi kontrol et. |
| `events_empty` / `batch_not_supported` | Batch formatı (events array) ile ilgili kısıt | Tek event gönderildiğinden emin ol. |

## 2) jetsolar.com.tr için

Heartbeat 400 alıyorsan büyük ihtimalle **site_not_found**: sayfadaki tracker, veritabanındaki site ile eşleşmeyen bir site id kullanıyor.

**Supabase SQL ile doğru site id:**
```sql
SELECT id, public_id, name, domain
FROM public.sites
WHERE domain ILIKE '%jetsolar%' OR domain = 'jetsolar.com.tr';
```

- Çıkan **public_id** değerini kopyala (örn. `site_abc123xyz`).
- jetsolar.com.tr’deki embed script’te bu değerin kullanıldığından emin ol:
  - `data-ops-site-id="<public_id>"` veya
  - `data-site-id="<public_id>"`
  - Veya `window.opsmantikConfig = { siteId: '<public_id>' };` (veya legacy: `window.opmantikConfig`)
- Script’te başka bir (eski/yanlış) site id varsa onu bu **public_id** ile değiştir, sayfayı yenile ve heartbeat’i tekrar dene.

## 3) Hâlâ 400 ise

- Response body’deki tam `code` ve varsa `message` / `error` değerini not al.
- İstek gövdesinde (Request Payload) `s`, `url` veya `u` alanlarının ne gönderildiğini kontrol et.
- Bu bilgilerle backend/sync validasyonunu tek tek eşleştir (site_not_found, missing_site_or_url, invalid_json, batch vb.).
