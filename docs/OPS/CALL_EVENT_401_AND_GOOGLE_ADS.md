# Call-Event 401 and Google Ads Not Showing — Troubleshooting

When a customer site (e.g. Kaliteli Bakıcı) shows **POST /api/call-event 401 (Unauthorized)** in the browser console and/or **Google Ads traffic does not appear** in the dashboard, use this checklist.

---

## 0. Güvenlik: Secret Kodda Olmamalı (GTM Gibi)

**Sorun:** Script tag’e `data-ops-secret` koyarsak secret **sayfa kaynağında / DOM’da** görünür. Herhangi biri “Sayfa kaynağını görüntüle” veya DevTools ile secret’ı alıp sahte call-event istekleri atabilir. Yani **secret’ın tarayıcıda olması güvenlik açığıdır**.

**Tag Manager (GTM) nasıl yapıyor?**  
GTM tarayıcıda **secret tutmaz**. İstekler ya (1) **kendi domain’inize** (first-party) gider, sizin sunucunuz auth ekleyip ileri iletir; ya da (2) Google’a gider, orada container ID + sunucu tarafı kontroller kullanılır. Secret hiçbir zaman sayfada görünmez.

**Doğru model (GTM gibi): First-party proxy (V2)**  
- Tarayıcı **sadece kendi sitenize** istek atar (örn. `https://kalitelibakici.com/wp-json/opsmantik/v1/call-event`).  
- Sayfada **secret yok**; script’te sadece `data-ops-site-id` ve `data-ops-proxy-url` vardır.  
- Sizin sunucunuz (WordPress eklentisi vb.) secret’a sahiptir, isteği imzalar ve OpsMantik’e (`/api/call-event/v2`) iletir.  
- Böylece secret **sadece sunucuda** kalır; tarayıcıda güvenlik açığı oluşmaz.

**Sonuç:** Secret tarayıcıda olmasın diye **proxy (V2)** tercih edilmeli. Proxy sadece WordPress değil; herhangi bir backend (Node, Vercel serverless, Cloudflare Worker, vb.) ile yapılabilir. WordPress’i olmayan siteler için de kendi domain’inizde küçük bir “imzala ve ilet” endpoint’i yeterli (aşağıda “Kesin çözüm” bölümü).

---

## 0.1 Kesin çözüm: Her site WordPress değil — Seçenekler

| Seçenek | Ne zaman | Açıklama |
|--------|----------|----------|
| **Proxy (V2)** | İstediğiniz her zaman | Secret tarayıcıda yok; en güvenli. **WordPress şart değil.** Kendi domain’inizde herhangi bir backend: WordPress eklentisi, Node/Express, Vercel serverless, Cloudflare Worker, Netlify Function, vb. Tarayıcı sadece sizin endpoint’inize POST atar; sunucu imzalar ve `POST https://console.opsmantik.com/api/call-event/v2` ile iletir. Örnek: `packages/wp-opsmantik-proxy` aynı mantığı PHP’de yapıyor; aynı akışı Node/Python/Go ile de yazabilirsiniz. |
| **Unsigned + sıkı kontroller** | Proxy kurulamıyorsa | `CALL_EVENT_SIGNING_DISABLED=1` ile production’da unsigned kabul edilebilir; **ne risk aldığınız** ve **hangi kontrollerin** olduğu dokümante (aşağıda “Unsigned mod risk ve kontroller”). Rate limit, CORS, replay zaten var; güvenlik seviyesi ~85 ise bu mod bir **bilinçli tercih** olarak kullanılabilir. |

---

## 0.2 Unsigned mod (CALL_EVENT_SIGNING_DISABLED=1) — Risk ve kontroller

**Prod’da unsigned açarsak saldırgan ne yapabilir?**

- **Yapamayacakları:** Başka sitelerin verisini okuyamaz, dashboard’a erişemez, secret çalamaz, kullanıcı hesabı ele geçiremez. Call-event sadece **yazma** (conversion kaydı); okuma yok.
- **Yapabilecekleri:** Sadece **izin verilen origin**’lerden (ALLOWED_ORIGINS) istek atabilir. Yani bir müşteri sitesinin sayfasından (veya o origin’i taklit edemiyorsa tarayıcıda doğrudan değil, CORS engeli olur). İzinli bir origin’den atılan isteklerle **sahte conversion** (sahte arama/WhatsApp tıklaması) eklenebilir. Etki: **veri kirliliği** (queue’da sahte kayıt, istatistik şişmesi, istenirse OCI’ye yanlış gclid çıkması). Yani tehdit **gizlilik değil, bütünlük ve kötüye kullanım**.

**Mevcut kontroller (rate limit, CORS, replay):**

| Kontrol | Nasıl | Etkisi |
|--------|--------|--------|
| **CORS** | Sadece `ALLOWED_ORIGINS` listesindeki origin’ler kabul edilir; production’da wildcard yok. | Rastgele internet sayfası call-event’e istek atamaz; sadece sizin tanımladığınız müşteri domain’leri. |
| **Rate limit (global)** | 50 istek/dakika per client (IP + User-Agent). | Aynı istemciden dakikada en fazla 50 call-event. |
| **Rate limit (per-site)** | 80 istek/dakika per (site_id + client). | Bir site için aynı istemci dakikada en fazla 80; bir siteyi şişirmek sınırlı. |
| **Replay cache** | Aynı event_id / imza kısa süre içinde tekrar kullanılamaz. | Aynı isteğin tekrar tekrar gönderilmesi engellenir. |
| **site_id doğrulama** | Body’deki site_id geçerli ve resolve edilebiliyor olmalı. | İstek sadece var olan bir site için kayıt açar; keyfi site_id kabul edilmez. |

**Çift kayıt zaten engelli:** Aynı session’da “1 telefon, 3 WhatsApp tıklandı” gibi gösterim, ham istek sayısı değil **session / intent bazlı** toplam. Veritabanında `(site_id, intent_stamp)` unique; aynı intent_stamp ile gelen ikinci istek **çift kayıt oluşturmaz** (idempotency: mevcut call döner veya noop). Yani sahte istekler aynı intent’i tekrar gönderse bile tabloda tek satır kalır; sayılar şişmez.

**İleride:** Saldırı / anomali tespit edilirse (örn. aynı fingerprint’ten anormal sıklıkta call-event) ek filtreler veya kalite kuralları (session başına makul tıklama limiti, şüpheli pattern’leri işaretleme) geliştirilebilir. Unsigned mod bu yüzden hem mevcut kontrollerle hem de geliştirilebilir filtrelerle yönetilebilir.

**Sonuç:** Rate limit, CORS, replay ve **intent_stamp idempotency** ile unsigned mod kontrollü bir risk. Güvenlik kontrolleriniz 85 seviyesinde ve artıyorsa, proxy mümkün olmayan siteler için **CALL_EVENT_SIGNING_DISABLED=1** prod’da bilinçli ve dokümante kullanılabilir. Ek önlem: ALLOWED_ORIGINS sıkı, Sentry/log ile anomali izleme; ileride per-site veya session bazlı filtreler eklenebilir.

---

## 0.3 401 Nasıl Düzeltilir?

**Üç yol:**

**1) Proxy (V2) — Tercih edilen (secret tarayıcıda yok)**  
- WordPress varsa: `packages/wp-opsmantik-proxy`; secret `wp-config.php` içinde.  
- WordPress yoksa: Kendi domain’inizde herhangi bir backend (Node, Vercel, Cloudflare Worker, vb.) ile aynı akış: tarayıcı sizin endpoint’e POST atar, sunucu imzalar ve `POST .../api/call-event/v2` ile iletir.  
- Script’te: `data-ops-site-id` + `data-ops-proxy-url`; **data-ops-secret yok**.  
- Detay: `docs/OPS/CALL_EVENT_PROXY_WORDPRESS.md` (mantık her stack’e uyar).

**2) Unsigned mod (prod’da kabul edilebilir)**  
- Vercel’de `CALL_EVENT_SIGNING_DISABLED=1` açın.  
- `ALLOWED_ORIGINS` içinde **sadece** gerçek müşteri domain’leri olsun (virgülle ayrılmış).  
- Script’te **data-ops-secret ve data-ops-proxy-url olmasın**; tracker imzasız POST atar, CORS + rate limit + replay ile korunursunuz.  
- Risk: izin verilen origin’den sahte conversion atılabilir (yukarıdaki “Unsigned mod risk ve kontroller”); mevcut kontrollerle sınırlı ve dokümante.

**3) Script’te secret (V1) — Sadece geçici / test**  
- Secret sayfada görünür (güvenlik açığı). Mümkünse proxy veya unsigned’a geçin.  
- Geçici: `node scripts/get-tracker-embed.mjs SITE_PUBLIC_ID` çıktısındaki tag.

---

## 1. Call-Event 401 (WhatsApp / phone click not recorded)

The `/api/call-event` endpoint returns **401** when **signing is required** and the request does not have valid headers or signature.

### 1.1 Possible causes

| Cause | What to check |
|-------|----------------|
| **Unsigned request, signing enabled** | Production has `CALL_EVENT_SIGNING_DISABLED` unset or `false`. The tracker sends no `X-Ops-Ts` / `X-Ops-Signature` (e.g. no `data-ops-secret` on the script tag). Server expects HMAC → 401. |
| **Wrong or rotated secret** | Site has `data-ops-secret` but the value does not match the secret stored in Supabase for that site (e.g. after rotation). Signature verification fails → 401. |
| **Missing or invalid headers** | `X-Ops-Site-Id`, `X-Ops-Ts` (9–12 digits), or `X-Ops-Signature` (64 hex) missing or malformed → 401. |
| **Clock skew** | `X-Ops-Ts` is more than 5 minutes in the past or 1 minute in the future → 401. |

### 1.2 Fix options (production: proxy önerilir, secret tarayıcıda risk)

**Production does not use `CALL_EVENT_SIGNING_DISABLED`.** All customer sites must use either the **first-party proxy (V2)** or, with accepted risk, **signed mode with secret in the page (V1)**.

**Önerilen — First-party proxy (V2, GTM gibi, secret tarayıcıda yok)**  
- Tarayıcı sadece **kendi domain’ine** POST atar (örn. `/wp-json/opsmantik/v1/call-event`). Sayfada secret yok.  
- Sunucuda (WordPress eklentisi vb.) secret tutulur; istek imzalanıp **POST /api/call-event/v2** ile OpsMantik’e iletilir.  
- Kurulum: `docs/OPS/CALL_EVENT_PROXY_WORDPRESS.md` ve `docs/HARDENING_V2_CALL_EVENT.md`.  
- Bu yöntem **Tag Manager’ın first-party modeliyle aynı güvenlik mantığıdır**: secret sadece sunucuda.

**Güvenlik riski — Signed mode (V1, secret script tag’te)**  
- Script tag’te `data-ops-secret` kullanılırsa secret **sayfa kaynağında görünür**; herkes kopyalayıp sahte istek atabilir.  
- Sadece geçici test veya proxy kurulana kadar kabul edilebilir; kalıcı çözüm olarak **önerilmez**.  
- Gerekirse: `data-ops-secret` ve `data-ops-site-id` ile script güncellenir; mümkün olan en kısa sürede proxy’ye geçilir.

**Unsigned mode (`CALL_EVENT_SIGNING_DISABLED=1`)**  
- Production’da kullanılmıyor. Sadece acil rollback için, risk kabulü ile; hemen ardından proxy veya imzalı moda dönülmeli. Bkz. `docs/OPS/SLA_SLO.md` Security Preconditions.

### 1.3 400 Bad Request (sadece bir sitede, örn. kalitelibakici.com)

Diğer siteler 200 dönerken **tek sitede 400** alıyorsanız istek gövdesi (body) veya site konfigürasyonu o sitede farklıdır.

**Hemen kontrol:**  
DevTools → Network → başarısız `POST /api/call-event` → **Response** sekmesi. Artık yanıtta `{ "error": "Invalid body", "hint": "..." }` dönüyor; `hint` alanı hangi alanın hata verdiğini söyler.

| Olası neden | hint / belirti | Çözüm |
|-------------|-----------------|--------|
| **Yanlış veya geçersiz site_id** | `site_id: Invalid site_id` veya `Invalid site_id` | site_id 32 karakter hex (public_id) veya UUID olmalı. O sitedeki script’te `data-ops-site-id` değerini kontrol edin; dashboard’daki Site ID ile birebir aynı olmalı. |
| **Fazladan alan (strict)** | `Unrecognized key(s)...` veya benzeri | Tracker veya sayfadaki başka bir script istek body’sine ek alan ekliyorsa API 400 döner. Tracker’ı güncel sürümle kullanın; başka eklenti aynı isteğe müdahale ediyorsa kapatıp deneyin. |
| **event_id UUID değil** | `event_id: Invalid uuid` | Tracker `event_id` gönderiyorsa geçerli UUID (örn. `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`) olmalı. Eski/minified script UUID üretmiyorsa güncel core.js kullanın. |
| **fingerprint boş veya çok uzun** | `fingerprint` ile ilgili hata | fingerprint 1–128 karakter olmalı. Session/fingerprint mantığı bozuksa düzeltingörün. |
| **url 2048’den uzun** | `url` ile ilgili hata | Sayfa URL’si çok uzunsa kısaltın veya API’de max uzunluk artırılabilir (nadir). |

**Kaliteli Bakıcı özelinde:** Önce 400 yanıtındaki `hint` değerine bakın. Çoğunlukla `data-ops-site-id` yanlış/yazım hatası veya o siteye özel eski/uyumsuz tracker sürümü olur.

### 1.4 Quick verification (401 / 403)

- Browser DevTools → Network: trigger a WhatsApp or phone click.  
- Find the **POST** to `https://console.opsmantik.com/api/call-event`.  
- If **401**: check Response body (e.g. `{ "error": "Unauthorized" }`). Then check Request Headers: presence and format of `X-Ops-Site-Id`, `X-Ops-Ts`, `X-Ops-Signature`.  
- If **403**: usually **Origin not allowed** → add that origin to `ALLOWED_ORIGINS`.  
- If **400**: check Response body for `hint` and fix the field listed above.

---

## 2. Google Ads traffic not showing in dashboard

Sessions are tagged as “Google Ads” when the **first request** for that session (landing) includes **gclid** (or wbraid/gbraid) in the URL. The sync worker and `source-classifier` set `traffic_source` / `gclid` from that first event.

### 2.1 Possible causes

| Cause | What to check |
|-------|----------------|
| **gclid missing from landing URL** | User lands on a URL that has no `gclid` (e.g. redirect strips query string, or landing page URL in Google Ads is wrong). No gclid → session not “Google Ads”. |
| **First event URL not sent or stripped** | Tracker must send the **full page URL** (including query string) in the first sync payload. If the client or a proxy strips query params, gclid is lost. |
| **Dashboard filter / date** | “Ads only” or date range may hide sessions; or the report is for a day with no gclid sessions. |
| **First-touch attribution** | If the user first visited the site directly (no gclid) and later came from an Ad in the same session, the session stays “Direct”. Only a **new** session starting with a gclid URL is “Google Ads”. |

### 2.2 Fix options

- **Google Ads:** Confirm the **final URL** (or tracking template) includes **{lpurl}** or equivalent so the landing page URL contains the click ID. Avoid redirects that drop query parameters.  
- **Tracker:** Ensure the first sync (page load) sends the **current document URL** with query string (e.g. `window.location.href` or equivalent). Do not strip `gclid`, `wbraid`, `gbraid`.  
- **Dashboard:** In OpsMantik, check “Traffic source” / “Kaynak” breakdown and date range; try “Tümü” (all) and a range that includes the test day.  
- **Verification:** From a **Google Ads click** (real or test), land on the site and immediately check DevTools → Network: first **POST /api/sync** request body should contain the full URL with `gclid=...`. Then in DB or dashboard, that session should have `gclid` set and traffic_source “Google Ads”.

---

## 3. Mixed Content (fonts) in console

Messages like “requested an insecure font … blocked; the content must be served over HTTPS” come from the **customer site** (theme/plugin loading fonts over `http://`), not from OpsMantik.

- Fix on the **customer side**: change font URLs to **https://** or use a protocol-relative URL / plugin that enforces HTTPS assets.  
- This does not fix 401 or Google Ads; it only removes browser mixed-content warnings and restores font loading.

---

## 4. Kaliteli Bakıcı — quick checklist

1. **Call-event 401**  
   - **Güvenli çözüm:** WordPress proxy (V2) kurun; script’te sadece `data-ops-site-id` ve `data-ops-proxy-url` olsun, **data-ops-secret olmasın**. Secret sadece `wp-config.php` (veya sunucu ortamında) olsun.  
   - Geçici/test: Script’te secret (V1) kullanılabilir ama secret sayfada görünür (güvenlik riski); kalıcı olarak proxy’ye geçin.  

2. **Google Ads not showing**  
   - Confirm landing URL from Google Ads contains `gclid`.  
   - Confirm first sync from that page sends full URL with `gclid`.  
   - Check dashboard traffic source breakdown and date range.  

3. **Font mixed content**  
   - Fix on Kaliteli Bakıcı: all font URLs over HTTPS (theme/plugin/config).
