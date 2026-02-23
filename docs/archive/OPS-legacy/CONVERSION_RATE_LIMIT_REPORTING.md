# Google Ads dönüşüm farkı + Sync rate limit raporlama

Bu dokümanda: (1) Google Ads’te 11 dönüşüm görünürken OpsMantik’te 1 görünmesinin nedenleri, (2) karşılaştırma için SQL sorguları, (3) sync rate limit’in amacı ve yüksek trafikli sitelerin limite takılmaması için yapılacaklar.

---

## 1) Google 11 vs OpsMantik 1 — Ne sayılıyor?

| Kaynak | Ne sayar? |
|--------|------------|
| **Google Ads** | Kendi tag’i (site içi conversion) + **Offline Conversion Import (OCI)** ile yüklenen dönüşümler. Bazen sadece OCI, bazen tag + OCI birlikte. |
| **OpsMantik dashboard “Dönüşüm” (sealed)** | Sadece **calls** tablosunda `status IN ('confirmed','qualified','real')` ve seçilen tarih aralığındaki kayıtlar. Ads-only filtrede ayrıca session’ın ads session olması gerekir. |

Farkın olası nedenleri:

- **Tarih aralığı:** Dashboard’da “bugün” seçiliyse sadece bugünkü sealed sayılır; Google’daki 11 farklı günlere yayılmış olabilir.
- **Kaynak farkı:** Google’da site tag’i veya başka bir pixel 11 sayıyorsa, OpsMantik sadece **satış onayı + OCI** ile giden sayıyı bilir (1).
- **OCI gecikmesi:** OCI kuyruğunda (QUEUED/PROCESSING) bekleyen veya henüz export edilmeyen dönüşümler Google’a düşmemiş olabilir; tersine Google’da görünenler başka kaynaktan da gelebilir.

Aşağıdaki SQL’lerle OpsMantik tarafında “bizim” sayıyı ve OCI durumunu netleştirebilirsin.

---

## 2) Raporlama SQL’leri

**Not:** `p_date_from` / `p_date_to` yerine doğrudan tarih kullanıyorsanız `CURRENT_DATE` veya `date_trunc('day', now())` ile bugünü alın. Site adı “Akana” gibi aramak için `sites.name` kullanılır; `sites.public_id` sync isteğindeki `s` alanıdır (rate limit override’da bu kullanılır).

### 2.1 Siteleri listele (isim, public_id, son event)

```sql
SELECT id, name, domain, public_id,
       (SELECT MAX(created_at) FROM events e JOIN sessions s ON e.session_id = s.id AND e.session_month = s.created_month WHERE s.site_id = sites.id) AS last_event_at
FROM sites
ORDER BY name;
```

### 2.2 Bugün site bazında: sealed (dashboard dönüşüm) vs OCI kuyruğu

Belirli bir site için (ör. Akana’nın `site_id`’si ile):

```sql
-- Bugünün başı (Türkiye UTC+3 için örnek; gerekirse timezone ayarlayın)
WITH today_range AS (
  SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul' AS day_start,
         date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul' + INTERVAL '1 day' AS day_end
),
site_lookup AS (
  SELECT id FROM sites WHERE name ILIKE '%akana%' LIMIT 1  -- veya public_id = '...'
)
SELECT
  (SELECT COUNT(*) FROM calls c, site_lookup sl, today_range tr
   WHERE c.site_id = sl.id
     AND c.created_at >= tr.day_start AND c.created_at < tr.day_end
     AND c.status IN ('confirmed','qualified','real')) AS sealed_today,
  (SELECT COUNT(*) FROM offline_conversion_queue oq, site_lookup sl, today_range tr
   WHERE oq.site_id = sl.id
     AND oq.created_at >= tr.day_start AND oq.created_at < tr.day_end
     AND oq.status = 'COMPLETED') AS oci_completed_today,
  (SELECT COUNT(*) FROM offline_conversion_queue oq, site_lookup sl, today_range tr
   WHERE oq.site_id = sl.id
     AND oq.created_at >= tr.day_start AND oq.created_at < tr.day_end
     AND oq.status IN ('QUEUED','PROCESSING','RETRY')) AS oci_pending_today;
```

### 2.3 Tüm siteler için bugünkü sealed + OCI özeti (karşılaştırma tablosu)

```sql
WITH today_start AS (
  SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul' AS ts
),
today_end AS (
  SELECT ts + INTERVAL '1 day' FROM today_start
)
SELECT
  s.public_id,
  s.name,
  (SELECT COUNT(*) FROM calls c
   WHERE c.site_id = s.id
     AND c.created_at >= (SELECT ts FROM today_start)
     AND c.created_at < (SELECT * FROM today_end)
     AND c.status IN ('confirmed','qualified','real')) AS sealed_today,
  (SELECT COUNT(*) FROM offline_conversion_queue oq
   WHERE oq.site_id = s.id
     AND oq.created_at >= (SELECT ts FROM today_start)
     AND oq.created_at < (SELECT * FROM today_end)
     AND oq.status = 'COMPLETED') AS oci_completed_today,
  (SELECT COUNT(*) FROM offline_conversion_queue oq
   WHERE oq.site_id = s.id AND oq.status IN ('QUEUED','PROCESSING','RETRY')) AS oci_pending_total
FROM sites s
ORDER BY sealed_today DESC NULLS LAST, s.name;
```

### 2.4 Site bazında günlük ortalama intent/event hacmi (limit patlayan siteleri bulmak için)

Sync rate limit **istek sayısı** ile ilgilidir (event sayısı değil); bir sayfa birçok event tek istekte (batch) gelebilir. Kabaca “hacim” için events/sessions sayısı fikir verir:

```sql
WITH daily AS (
  SELECT
    s.site_id,
    date_trunc('day', e.created_at AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul' AS day,
    COUNT(*) AS events
  FROM events e
  JOIN sessions s ON e.session_id = s.id AND e.session_month = s.created_month
  WHERE e.created_at >= now() - INTERVAL '14 days'
    AND e.event_category != 'heartbeat'
  GROUP BY 1, 2
)
SELECT
  si.name,
  si.public_id,
  ROUND(AVG(d.events)::numeric, 1) AS avg_events_per_day,
  MAX(d.events) AS max_events_one_day
FROM daily d
JOIN sites si ON si.id = d.site_id
GROUP BY si.id, si.name, si.public_id
ORDER BY avg_events_per_day DESC;
```

Bu listeyi “günlük ortalama 40–50 intent gelen” siteleri tespit etmek ve rate limit override verilecek siteleri seçmek için kullanabilirsiniz.

---

## 3) Sync rate limit: ne için var, neden patlıyor?

- **Ne:** `/api/sync` için **site + client (IP + UA)** bazlı limit. Varsayılan: **100 istek / 60 saniye** (`DEFAULT_RL_LIMIT = 100`, `RL_WINDOW_MS = 60000`). Key: `siteId:clientId` (site yoksa sadece `clientId`).
- **Amaç:** Abuse / DoS’u sınırlamak. Redis (Upstash) ile dağıtık; 429 dönen istekler **faturalandırılmaz** (idempotency row yazılmaz).
- **Neden “40–50 intent gelen” siteler patlıyor:** Limit **dakikalık**; aynı IP’den (ör. ofis, tek kullanıcı çok sekme) kısa sürede 100+ sync isteği gelirse 429 alır. Günlük 40–50 intent olsa bile, trafik dalgalı geliyorsa bir dakikada 100’ü aşan istek olabilir.

---

## 4) Yüksek trafikli sitelerin limite takılmaması için ne yapılır?

### A) Site bazında limit artırımı (önerilen)

Belirli siteler için limiti 100’ün üzerine çıkarın. Production ortam değişkeni:

- **Name:** `OPSMANTIK_SYNC_RL_SITE_OVERRIDE`
- **Value:** `public_id1:limit1,public_id2:limit2` (örn. `b3e9634575df45c390d99d2623ddcde5:500,akana_site_public_id:500`)

Örnek: Günlük ortalama 40–50 intent alan ve patlayan siteleri 2.4 sorgusu ile bulup, her biri için 300–500/dk uygun olabilir. Deploy sonrası aynı site için 429 azalmalı.

### B) Varsayılan limiti global artırmak

Tüm siteler için 100/dk yerine 300 veya 500/dk kullanmak isterseniz `app/api/sync/route.ts` içinde:

- `DEFAULT_RL_LIMIT = 100` → `300` (veya `500`) yapılır.

Bu, abuse’a karşı korumayı gevşetir; mümkünse önce A ile site bazlı çözmek daha kontrollü.

---

## 5) Özet

| Konu | Aksiyon |
|------|--------|
| Google 11 vs bizde 1 | Tanımları karşılaştır (dashboard = sealed; Google = tag + OCI). 2.2 / 2.3 SQL ile bugünkü sealed ve OCI completed/pending sayılarını çekin. |
| Hangi siteler limite takılıyor | 2.4 ile günlük ortalama event/intent hacmine bakın; 429 aldığı bilinen siteleri override listesine ekleyin. |
| Limit ne için | Abuse/DoS; 429 = billable değil. |
| Limit patlamasın | `OPSMANTIK_SYNC_RL_SITE_OVERRIDE` ile yüksek hacimli sitelere 300–500/dk verin; gerekirse `DEFAULT_RL_LIMIT` artırın. |

Akana SPA’nın `public_id`’sini bulmak için 2.1’de `name ILIKE '%akana%'` kullanın; override’a `public_id:500` ekleyin.
