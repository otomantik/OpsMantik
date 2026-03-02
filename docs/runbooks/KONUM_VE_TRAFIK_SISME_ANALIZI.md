# Konum Yanlışlığı ve Trafik Şişmesi — Analiz Raporu

**Bağlam:** Muratcan Akün sitesi — eski dönemde kumar siteleri bulaşmıştı; şu an temiz HTML Cloudflare’de yayında. Konum bilgileri yanlış geliyor; Google Ads’te 10 tıklama varken sistemde 129 görünüyor.

**Tarih:** 2026-02-25

---

## 1. Bu Durumun Sistemdeki Karşılığı

| Olgu | Sistemdeki adı / mantık |
|------|--------------------------|
| Konum hep yanlış | **Ghost geo / edge geo** — İstek Vercel’e Cloudflare (veya başka proxy) üzerinden geliyorsa, Vercel gelen IP’yi “edge” (Rome, Amsterdam vb.) görüyor; gerçek kullanıcı konumu değil. |
| 10 Ads tıklaması, sistem 129 | **Trafik şişmesi (inflated traffic)** — Karşılaştırılan metrikler farklı: Ads = tıklama (click), sistem = oturum (session) veya olay (event) sayısı. Ayrıca bot/crawler, GCLID’siz trafiğin yanlış etiketlenmesi veya idempotency/fingerprint farkıyla aynı tıklamanın birden fazla oturum/event üretmesi. |
| Eski kumar + şimdi temiz site | **Tarihsel kirlilik + referrer/domain karışımı** — Eski veri hâlâ DB’de; referrer veya domain filtreleri yoksa eski trafik de sayıma giriyor. |

---

## 2. Konum Neden Yanlış Geliyor?

### 2.1 Konumun Teknik Kaynağı

Sistem konumu şu öncelikle alıyor (`lib/geo.ts`):

1. **Meta override** (istek gövdesiyle gelen `meta.city`, `meta.district` vb.)
2. **Generic proxy header’ları:** `x-city`, `x-forwarded-city`, `x-district`, `x-country`
3. **Cloudflare:** `cf-ipcity`, `cf-ipdistrict`, `cf-ipcountry`
4. **Vercel:** `x-vercel-ip-city`, `x-vercel-ip-country`
5. Hiçbiri yoksa: **Unknown**

**Önemli:** Konum **IP’den değil**, doğrudan **HTTP header’larından** türetiliyor. Yani “hangi sunucu bu isteği gördü?” sorusunun cevabına bağlı.

### 2.2 Cloudflare + Vercel Senaryosu

- Site **Cloudflare’de** (HTML orada serve ediliyor).
- Tracker / sync isteği muhtemelen **Vercel’de** (`/api/sync` veya benzeri).
- Akış: **Kullanıcı → Cloudflare → (opsiyonel) → Vercel.**

Vercel’e gelen istekte:

- **cf-*** header’ları: Cloudflare edge’in kendisi (bazen kullanıcıya yakın edge).
- **x-vercel-ip-***: Vercel’in gördüğü IP’ye göre geo — bu IP çoğu zaman **Cloudflare’in çıkış IP’si** veya bir proxy IP’si olur (Rome, Amsterdam, Frankfurt vb.).
- **x-forwarded-for** doğru ayarlı değilse, “gerçek client IP” hiç kullanılmıyor; konum hep edge/proxy konumu olur → **Rome/Amsterdam ghost**.

Sistemde zaten **Rome / Amsterdam / Roma** “ghost” olarak işaretlenip UI’da **Unknown** gösteriliyor (`lib/geo/upsert-session-geo.ts`, `lib/utils/formatting.ts`). Yani konum yanlış gelince ekranda çoğu zaman “Bilinmiyor” görünmesi bu yüzden.

### 2.3 GCLID Varsa: ADS Geo Öncelikli

Call-event veya session’da **GCLID + `loc_physical_ms` / `loc_interest_ms`** varsa sistem **Google Ads hedef konumunu** kullanıyor (`lib/geo/upsert-session-geo.ts`, `lib/ingest/process-sync-event.ts`). Yani:

- **Konum kaynağı = “gclid”** ise → Konum Ads’ten (doğru hedef bölge).
- Konum **IP/edge**’den geliyorsa → Ghost (Rome/Amsterdam) veya yanlış edge konumu.

Özet: Şu an “konum hep yanlış” ise, büyük olasılıkla **çoğu oturumda konum IP/edge’den** geliyor; Cloudflare → Vercel zincirinde **gerçek client konumu** header’lara taşınmıyor veya ADS geo (GCLID + loc_*) hiç set edilmiyor.

---

## 3. 10 Tıklama vs 129 — Trafik Şişmesi Mantığı

### 3.1 Metrik Farkı

- **Google Ads “tıklama”:** Reklama tıklayan kişi (click) sayısı. Bir kullanıcı 3 tıklasa bile Ads’te genelde 3 click sayılır; bazen “unique” tıklama da raporlanır.
- **Sistemdeki 129:** Büyük ihtimalle:
  - **Oturum (session) sayısı**, veya
  - **Olay (event) sayısı**.

Bir Ads tıklaması:

- 1 **session** açar (ilk sayfa + GCLID ile).
- O session içinde birden fazla **event** (page_view, heartbeat, click, call_intent…) oluşur.
- Idempotency **event**’leri dedupe eder (aynı fingerprint + url + time bucket = tek sayım).
- **Session** idempotency ile dedupe edilmez; her “yeni session” bir satır.

Yani: **10 gerçek tıklama** bile olsa, sistemde 10 session görmek beklenir. 129 session görüyorsanız, bu 10’un çok üzerinde; aşağıdaki nedenlerden biri veya birkaçı devrede demektir.

### 3.2 Olası Nedenler

| Neden | Açıklama |
|-------|----------|
| **Bot / crawler** | Tarayıcı olmayan istemciler (bot, script, eski kumar sitelerinden iframe/link) GCLID taşımadan sayfayı açıyor; yine de session/event yazılıyor. Trafik “Ads” değil ama aynı site_id altında toplam 129’u şişiriyor olabilir. |
| **GCLID’siz trafik “Ads” sayılıyor mu?** | Hayır. `determineTrafficSource` GCLID/wbraid/gbraid varsa “Google Ads” diyor. GCLID yoksa organic/referral/direct vb. Yani 129’un hepsi “Ads” görünüyorsa, her birinde bir şekilde click_id geliyor demektir. |
| **Farklı URL / fingerprint = çok session** | Idempotency key: `site_id + event_name + url + fingerprint + time_bucket`. Aynı kullanıcı farklı sayfa (url) veya her seferinde farklı fingerprint (örn. script her seferinde fp üretiyorsa) ile gelirse, aynı tıklama birden fazla “benzersiz” event/session gibi işlenebilir. Session oluşturma ayrı; ilk istekte session açılıyor, fingerprint/session_id tutarlı değilse “yeni session” patlaması olabilir. |
| **Eski kumar dönemi verisi** | Tarih aralığı filtreleme yoksa veya “son 7 gün” gibi dar filtre kullanılmıyorsa, geçmişte kalan (kumar referrer’lı, bot’lu) session/event’ler de 129’a dahil ediliyor olabilir. |
| **Script / çoklu istek** | Sayfada tracker çok sık tetikleniyorsa (her scroll, her 2 saniyede heartbeat) ve fingerprint veya session_id istemcide tutarlı gönderilmiyorsa, sunucu tarafında birden fazla session açılıyor olabilir. |

### 3.3 Sistemde Hangi Metrik 129?

- Dashboard’da “129” **session** mı, **event** mi, yoksa **“tıklama” (click)** etiketli bir KPI mı?
- Filtre: **Sadece Google Ads (GCLID’li) session’lar** seçili mi?
- Tarih aralığı: **Son 1 gün / 7 gün** gibi dar mı?

Bu üçü netleşmeden “10 vs 129” tek bir cümleyle açıklanamaz; yukarıdaki mantık hangi metrik 129 ise ona göre yorumlanmalı.

---

## 4. Yapılabilecekler (Öneriler)

### 4.1 Konum Doğruluğu

1. **Cloudflare → Vercel’e gerçek client bilgisini iletmek**
   - Cloudflare’de **Transform Rule** veya **Worker** ile:
     - `CF-Connecting-IP` (gerçek client IP) değerini `X-Forwarded-For` veya `X-Real-IP` olarak ekleyin.
     - Mümkünse Cloudflare’in sağladığı **city/country** bilgisini `X-City`, `X-Country` (veya `X-Forwarded-City` vb.) ile Vercel’e iletin.
   - Böylece Vercel tarafında `lib/geo.ts` **generic** (x-city, x-forwarded-*) path’ine düşer; edge (Rome/Amsterdam) değil, Cloudflare’in çözdüğü konum kullanılır.

2. **Call-event / embed’de ADS geo kullanımı**
   - GCLID + `loc_physical_ms` / `loc_interest_ms` zaten varsa konum **ADS** kaynağıyla yazılıyor. Embed/call-event tarafında bu alanların doğru ve tutarlı gönderildiğinden emin olun; böylece Ads’e tıklayan kullanıcı için konum “Ads hedef” ile uyumlu olur.

3. **Ghost listesini genişletmek (opsiyonel)**
   - Sadece Rome/Amsterdam değil, sık gördüğünüz yanlış şehirler (örn. Frankfurt, Londra) de `GHOST_GEO_CITIES` benzeri bir listede işaretlenip UI’da “Bilinmiyor” yapılabilir; böylece yanlış konum en azından raporlara “doğru şehir” diye yansımaz.

### 4.2 Trafik Şişmesi (10 vs 129)

1. **Metrik ve filtreyi netleştirin**
   - 129’un **session** mı **event** mi olduğunu ve dashboard’da hangi filtrelerin (tarih, traffic_source = Google Ads) açık olduğunu not edin.
   - Google Ads ile **aynı tanımı** kullanın: örn. “GCLID’li session sayısı” veya “ilk event’i page_view olan ve GCLID’li session”.

2. **Sadece Ads trafiğini gösterin**
   - Panoda **traffic_source = Google Ads** (ve gerekirse `gclid IS NOT NULL`) filtresiyle sayım yapın. Böylece organik/bot karışımı 129’dan düşer; 10’a yakın bir sayı çıkıyorsa sorun “karışık trafik”tir.

3. **Tarih aralığı**
   - “Son 24 saat” / “Son 7 gün” gibi dar aralık kullanın. Eski kumar dönemi verisi varsa, bu veri zamanla temizlenene kadar dar aralık daha anlamlı olur.

4. **Bot / anomali**
   - Session veya event’te **user_agent**, **referrer**, **isp_asn** ile şüpheli kümeleri (bilinen bot UA’ları, eski kumar domain’leri) tespit edip:
     - Ya raporlardan filtreleyin,
     - Ya da ileride **fraud-quarantine** / “bot” işaretlemesi ile sayımdan çıkarın.

5. **Fingerprint / session tutarlılığı**
   - İstemcide **fingerprint** ve **session_id** (veya sid) aynı ziyarette sabit mi, kontrol edin. Her istekte farklı fingerprint üretilirse idempotency farklı key’lere düşer; session birleşmesi de zorlaşır. Mümkünse aynı sayfa/session’da aynı fp kullanın.

6. **Eski veriyi temizleme / arşiv**
   - Kumar dönemine ait referrer/domain’leri tespit edip:
     - Bu session/event’leri “archive” veya “exclude_from_ads_reporting” gibi bir bayrakla işaretleyebilir,
     - Veya sadece raporlarda tarih/referrer filtresiyle hariç tutabilirsiniz.

---

## 5. Özet Tablo

| Sorun | Sistemdeki karşılık | Ne yapılabilir |
|-------|----------------------|-----------------|
| Konum yanlış | Edge/proxy (ghost) geo; Cloudflare → Vercel’de client konumu yok | CF’den X-City, X-Forwarded-For ile client bilgisini ilet; ADS geo (GCLID+loc_*) kullan |
| Trafik 10 değil 129 | Metrik karışıklığı (session/event) + bot/eski veri/fingerprint | Ads filtresi + dar tarih + bot/referrer analizi + fp tutarlılığı |
| Eski kumar bulaşması | Tarihsel kirlilik | Dar tarih aralığı; referrer/domain filtreleri; gerekirse arşivleme |

---

**Sonuç:** Konum sorunu büyük ölçüde **Cloudflare ile Vercel arasında client IP/konum bilgisinin iletilmemesinden** ve ADS geo’nun (GCLID+loc_*) kullanılmamasından kaynaklanıyor. 129 sayısı ise **metrik tanımı (session vs event vs Ads tıklama)** ve **filtre (tarih, sadece Ads)** ile netleştirilmeli; ardından bot ve eski veri etkisi azaltılabilir.
