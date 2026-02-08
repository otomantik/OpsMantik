# Kaliteli Bakıcı — Site Sorguları ve Tracker Kodu

Bu dosyada Kaliteli Bakıcı sitesi için SQL sorguları ve tracker embed alma adımları var.

---

## 1. Site bilgisi (public — Supabase SQL Editor’da çalıştır)

```sql
-- Kaliteli Bakıcı: site id, public_id, ad, domain
SELECT id, public_id, name, domain, created_at
FROM public.sites
WHERE domain ILIKE '%kalitelibakici%'
   OR name ILIKE '%kaliteli%bakici%'
   OR name ILIKE '%Kaliteli%Bakıcı%';
```

Çıktıda **public_id** (32 karakter hex) tracker’da `data-ops-site-id` olarak kullanılır.

---

## 2. Kaliteli Bakıcı — Kayıt yapıyor mu? (Supabase SQL Editor)

Aşağıdaki sorgular bu site için **session**, **event** ve **call** kayıtlarının gelip gelmediğini gösterir. Hepsini sırayla çalıştırabilirsiniz.

**Son 24 saatte session sayısı:**
```sql
SELECT COUNT(*) AS session_count_24h
FROM public.sessions s
JOIN public.sites st ON st.id = s.site_id
WHERE st.domain ILIKE '%kalitelibakici%'
  AND s.created_at >= NOW() - INTERVAL '24 hours';
```

**Son 24 saatte event sayısı:**
```sql
SELECT COUNT(*) AS event_count_24h
FROM public.events e
JOIN public.sessions s ON s.id = e.session_id AND s.created_month = e.session_month
JOIN public.sites st ON st.id = s.site_id
WHERE st.domain ILIKE '%kalitelibakici%'
  AND e.created_at >= NOW() - INTERVAL '24 hours';
```

**Son 24 saatte call (telefon/WhatsApp) sayısı:**
```sql
SELECT COUNT(*) AS call_count_24h
FROM public.calls c
JOIN public.sites st ON st.id = c.site_id
WHERE st.domain ILIKE '%kalitelibakici%'
  AND c.created_at >= NOW() - INTERVAL '24 hours';
```

**Özet (tek sorguda):**
```sql
SELECT
  (SELECT COUNT(*) FROM public.sessions s JOIN public.sites st ON st.id = s.site_id
   WHERE st.domain ILIKE '%kalitelibakici%' AND s.created_at >= NOW() - INTERVAL '24 hours') AS sessions_24h,
  (SELECT COUNT(*) FROM public.calls c JOIN public.sites st ON st.id = c.site_id
   WHERE st.domain ILIKE '%kalitelibakici%' AND c.created_at >= NOW() - INTERVAL '24 hours') AS calls_24h,
  (SELECT MAX(s.created_at) FROM public.sessions s JOIN public.sites st ON st.id = s.site_id
   WHERE st.domain ILIKE '%kalitelibakici%') AS last_session_at,
  (SELECT MAX(c.created_at) FROM public.calls c JOIN public.sites st ON st.id = c.site_id
   WHERE st.domain ILIKE '%kalitelibakici%') AS last_call_at;
```

- **sessions_24h** > 0 → Sync/tracker çalışıyor, sayfa görüntüleme geliyor.  
- **calls_24h** > 0 → Call-event (telefon/WhatsApp tıklaması) kaydı yapılıyor.  
- **last_session_at** / **last_call_at** → En son kayıt zamanı.

**Son 15 dakikadaki call’ları listele (yeni tıklama geldi mi?):**
```sql
SELECT c.id, c.created_at, c.intent_action, c.intent_target, c.intent_stamp, c.status
FROM public.calls c
JOIN public.sites st ON st.id = c.site_id
WHERE st.domain ILIKE '%kalitelibakici%'
  AND c.created_at >= NOW() - INTERVAL '15 minutes'
ORDER BY c.created_at DESC
LIMIT 20;
```
Sayfada yeni bir tıklama yaptıktan sonra bu sorguyu tekrar çalıştırın; en üstte yeni satır görünmeli. Görünmüyorsa: Network’te `/api/call-event` 200 mü, 400/401 mi bakın; aynı butona tekrar tekrar tıklıyorsanız `intent_stamp` aynı kalabilir ve idempotency nedeniyle yeni satır eklenmez (aynı tıklama tek sayılır).

---

## 2b. Kayıtlar DB'de var ama panele (Qualification Queue) düşmüyor

Paneldeki kuyruk (Hunter/Qualification Queue) **sadece belirli koşulları** sağlayan call kayıtlarını gösterir. Aşağıdakileri kontrol edin.

**1) `source = 'click'` zorunlu**  
RPC `get_recent_intents_lite_v1` yalnızca `calls.source = 'click'` olan satırları döndürür. Eğer kayıtlar eski bir entegrasyonla veya farklı bir yolla `source = 'api'` veya `NULL` ile yazıldıysa panelde görünmez.

**Kayıtların source değerini kontrol et:**
```sql
-- Kaliteli Bakıcı: son call'ların source ve status değerleri
SELECT c.id, c.created_at, c.source, c.status, c.intent_action, c.intent_target
FROM public.calls c
JOIN public.sites st ON st.id = c.site_id
WHERE st.domain ILIKE '%kalitelibakici%'
ORDER BY c.created_at DESC
LIMIT 20;
```

- Hepsi `source = 'click'` ise → bir sonraki adıma geçin.  
- `source` NULL veya `api` ise → panel bu satırları göstermez. Güncel call-event API'si yeni kayıtları `source: 'click'` ile yazar; eski/yanlış kayıtları tek seferlik düzeltmek için (sadece gerekirse):

```sql
-- Sadece bu site için ve sadece intent bekleyen kayıtları 'click' yap (tek seferlik)
UPDATE public.calls c
SET source = 'click'
FROM public.sites st
WHERE st.id = c.site_id
  AND st.domain ILIKE '%kalitelibakici%'
  AND (c.source IS NULL OR c.source <> 'click')
  AND (c.status IS NULL OR c.status = 'intent');
```

**2) Tarih aralığı (TRT "bugün")**  
Panel "Bugün" seçiliyken TRT'ye göre bugünün yarı-açık aralığı kullanılır: `[from, to)` (to dahil değil). Kayıtların `created_at` değeri bu aralıkta olmalı. "Dün" seçiliyse dünün TRT aralığı kullanılır. Panelde **Bugün** seçili mi ve kullanıcının tarayıcı saati doğru mu kontrol edin.

**3) Site ve yetki**  
Dashboard'a `/dashboard/site/<site-uuid>` ile giriyorsunuz; `<site-uuid>` sites tablosundaki `id` (UUID) olmalı. Giriş yapan kullanıcı bu siteye sahip veya üye olmalı; aksi halde RPC `access_denied` döner ve liste boş gelir.

**Özet:** Çoğu durumda sebep **`source <> 'click'`** olan eski/yanlış kayıtlardır. Yukarıdaki SELECT ile `source` değerine bakın; gerekirse UPDATE ile düzeltip paneli yenileyin.

**source zaten 'click' ama panel hâlâ boşsa** (kayıtlar DB'de görünüyor, panelde görünmüyor):

1. **Tarih aralığı (TRT)**  
   Panel "Bugün" = TRT bugünü `[from, to)` (yarı-açık). Örn. TRT 9 Şubat = `2026-02-08T21:00:00.000Z` – `2026-02-09T21:00:00.000Z`.  
   Tarayıcıda adres çubuğuna bakın: `/dashboard/site/<uuid>?from=...&to=...`. `from` ve `to` bu aralıkta mı? Sayfayı yenileyip tekrar "Bugün" ile açın; bazen ilk açılışta `from`/`to` eski kalabiliyor.  
   **"Dün"** seçin: 8 Şubat 19:54 ve 17:17 UTC kayıtları "Dün"de görünmeli (TRT 8 Şubat günü).

2. **Network isteği**  
   DevTools → Network → Filtre: `get_recent_intents_lite_v1` veya `rpc`. Paneli yenileyin. İstekte `p_site_id` = site UUID (örn. `4218d69f-92cd-4f46-94fe-cf97605755eb`), `p_date_from` / `p_date_to` TRT günü ile uyumlu mu? Yanıt 200 ve body’de dizi boş mu `[]` yoksa dolu mu kontrol edin.

3. **Geliştirme logu (sadece dev)**  
   Projeyi `npm run dev` ile çalıştırıyorsanız, paneli açıp konsolu açın. "Queue RPC get_recent_intents_lite_v1" logunda `rowCount` ve `p_date_from` / `p_date_to` değerlerine bakın. `rowCount > 0` ama panel boşsa filtre/parse tarafında sorun olabilir; `rowCount === 0` ise RPC bu aralıkta kayıt dönmüyor (tarih veya site_id kontrolü).

4. **Site URL’i**  
   Panel adresi mutlaka **UUID** ile olmalı: `/dashboard/site/4218d69f-92cd-4f46-94fe-cf97605755eb`. `public_id` (hex) ile açıyorsanız sayfa 404 veya yanlış site açılır; doğru siteye UUID ile girin.

---

## 3. Secret (sadece postgres / service_role)

Secret’ı **Supabase Dashboard → SQL Editor**’da çalıştırırken proje sahibi (postgres) ile çalışıyorsanız aşağıdaki sorgu site’in secret’ını döner. (RPC `service_role` ile çağrılabiliyor; SQL Editor bazen postgres kullanır.)

```sql
-- Önce site id'yi alın (yukarıdaki sorgudan id sütunu)
-- Aşağıda YOUR_SITE_UUID yerine o id'yi yazın.

SELECT current_secret
FROM private.get_site_secrets(
  (SELECT id FROM public.sites WHERE domain ILIKE '%kalitelibakici%' LIMIT 1)
)
LIMIT 1;
```

**Alternatif (secret’ı hiç SQL’de açmayın):** Proje kökünde:

```bash
node scripts/get-tracker-embed.mjs BURAYA_PUBLIC_ID
```

Örnek: `node scripts/get-tracker-embed.mjs b298a0393f0541c6bd7e4643269abcc6`  
Çıktıda hem public_id hem secret içeren hazır script satırı gelir.

---

## 4. Tracker kodu (embed) — İki yöntem

### A) Unsigned mod (CALL_EVENT_SIGNING_DISABLED=1 ise)

`ALLOWED_ORIGINS` içinde `https://www.kalitelibakici.com` (ve gerekiyorsa `https://kalitelibakici.com`) olmalı. Script’te **secret veya proxy yok**:

```html
<script
  src="https://console.opsmantik.com/assets/core.js"
  data-ops-site-id="BURAYA_PUBLIC_ID_32HEX"
  data-api="https://console.opsmantik.com/api/sync"
></script>
```

`BURAYA_PUBLIC_ID_32HEX` = yukarıdaki 1. sorgudan dönen **public_id**.

### B) İmzalı mod (secret ile — secret sayfada görünür, risk)

```bash
node scripts/get-tracker-embed.mjs BURAYA_PUBLIC_ID
```

Çıkan tek satırlık `<script ... data-ops-secret="...">` tag’ini sayfaya yapıştırın. Mümkünse proxy (V2) kullanın; secret tarayıcıda olmasın.

### C) Proxy (V2 — önerilen)

WordPress’te proxy kuruluysa:

```html
<script
  src="https://console.opsmantik.com/assets/core.js"
  data-ops-site-id="BURAYA_PUBLIC_ID_32HEX"
  data-ops-proxy-url="https://www.kalitelibakici.com/wp-json/opsmantik/v1/call-event"
  data-api="https://console.opsmantik.com/api/sync"
></script>
```

---

## 5. Tüm bilgiyi tek sorguda (site + secret var mı?)

```sql
-- Site bilgisi + bu site için secret tanımlı mı?
-- Not: private.site_secrets sadece postgres/service_role ile okunabilir; SQL Editor'da proje sahibi ile çalıştırın.
SELECT s.id, s.public_id, s.name, s.domain,
       EXISTS (SELECT 1 FROM private.site_secrets ss WHERE ss.site_id = s.id) AS has_secret
FROM public.sites s
WHERE s.domain ILIKE '%kalitelibakici%'
   OR s.name ILIKE '%kaliteli%bakici%';
```

`has_secret = true` ise imzalı mod veya proxy kullanılabilir; `false` ise önce bu site için secret oluşturup `private.set_site_secrets_v1` ile kaydedin (service_role gerekir). Alternatif: `node scripts/get-tracker-embed.mjs <public_id>` çalıştırın; "No secret found" derse secret yoktur.

---

## 6. Hızlı kontrol listesi

1. **1. sorguyu** çalıştır → `public_id` ve `id` (UUID) al.
2. **4. sorguyu** çalıştır → `has_secret` true mu kontrol et.
3. Secret yoksa: Supabase’de bu site için secret oluştur (örn. `private.set_site_secrets_v1` ile veya mevcut provisioning).
4. Tracker: Unsigned kullanıyorsan **3A** (sadece `data-ops-site-id`), proxy kullanıyorsan **3C**, geçici imzalı kullanacaksan **3B** (script çıktısı).
5. Kaliteli Bakıcı sayfasında script’i güncelle; WhatsApp/telefon tıkla → Network’te `/api/call-event` 200 veya 401/400’de yanıt body’sine bak.
