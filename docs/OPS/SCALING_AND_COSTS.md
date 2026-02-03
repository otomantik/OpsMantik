# OpsMantik — Ölçek Kapasitesi, Maliyetler ve Premium Ölçekleme

**Senaryo:** Ürün canlıya alındı; Google’a henüz dönüşüm gönderilmiyor (OCI opsiyonel).  
**Varsayım:** Her sitede günde **100 ziyaret** (sayfa görüntüleme + event’ler).

---

## 1. Mevcut altyapı (kısa)

| Bileşen | Kullanım | Limit / not |
|--------|----------|-------------|
| **Vercel** | Next.js host, API routes, serverless | Plana göre invocation / bandwidth |
| **Supabase** | Auth, DB (sessions, events, calls), RLS, Realtime | DB size, connection, Realtime eşzamanlı |
| **Upstash Redis** | Rate limit (sync 100/dk, call-event 50/dk), stats (captured/gclid/junk) | Komut / gün limiti |
| **QStash** | Sync → worker async kuyruk | Mesaj sayısı, retry |

---

## 2. Site başına kabaca yük (100 ziyaret/gün)

- **Sync:** Ziyaret başı ~2–5 istek (pageview, event, heartbeat). Ortalama **~350 istek/site/gün**.
- **QStash:** Her sync = 1 publish + 1 worker çağrısı → **~350 mesaj/site/gün**.
- **Redis:** Sync tarafında rate-limit (IP başına 100/dk), worker tarafında `hincrby` (stats). 100 ziyaret dağılmış → rate limit aşılmaz. **~350 incr + 350 hincrby + stats read** (dashboard açıkken).
- **Supabase:** ~100 session, ~300–500 event, call sayısı değişken. **~500–1000 row/site/gün** (session+event+call).
- **Vercel:** Sync + worker + dashboard API. **~700+ invocation/site/gün** (sync 350 + worker 350 + dashboard).

---

## 3. Mevcut altyapı “kaç siteye dayanır?” (kaba)

- **Rate limit:** Sync 100/dk/IP. 100 ziyaret/gün/site = dakikada birkaç istek. **10–10.000 site** için tek IP’de patlamaz; dağıtık ziyaretçi IP’leriyle sorun olmaz.
- **Darboğazlar:**
  - **QStash:** Ücretsiz/plan limiti (örn. 500 mesaj/gün). 2 site × 350 = 700 → ücretsiz aşılır. **Premium/ücretli plan gerekir.**
  - **Upstash Redis:** Ücretsiz 10.000 komut/gün. 10 site × ~700 komut ≈ 7.000 → **~10–15 site** civarı. Sonrası ücretli.
  - **Supabase:** Free tier 500 MB, 2 proje. Ciddi satır birikimi 50–100+ sitede storage/connection hissettirir. **Pro önerilir.**
  - **Vercel:** Hobby’de 100 GB-hour. 10 site × ~700 invocation ≈ 7.000 invocation/gün → genelde dayanır; **50+ site** için Pro daha güvenli.

**Kısa cevap:**  
- **Free/Hobby ile:** Kabaca **5–15 site** (günde 100 ziyaret/site) sınırda; QStash + Redis limitleri önce gelir.  
- **Premium (Vercel Pro + Supabase Pro + Upstash paid + QStash paid) ile:** **50–200 site** rahat, **500–1000 site** planlı büyütme ve izleme ile mümkün. **10.000 site** için mimari değişiklik gerekir (kuyruk/worker ayrımı, DB sharding/partition, cache katmanı).

---

## 4. Maliyet tahmini (günlük 100 ziyaret × N site)

Fiyatlar yaklaşık; güncel fiyatları kontrol edin.

### 4.1 10 site (100 ziyaret/site/gün)

| Servis | Tier | Tahmini aylık (USD) |
|--------|------|----------------------|
| Vercel | Pro | ~20 |
| Supabase | Pro | ~25 |
| Upstash Redis | Pay-as-you-go | ~5–15 |
| QStash | Paid (ör. 10K mesaj) | ~10–20 |
| **Toplam** | | **~60–80** |

### 4.2 50 site

| Servis | Tier | Tahmini aylık (USD) |
|--------|------|----------------------|
| Vercel | Pro | ~20–50 |
| Supabase | Pro | ~25–50 |
| Upstash | Paid | ~20–40 |
| QStash | ~525K mesaj/ay | ~50–100 |
| **Toplam** | | **~110–240** |

### 4.3 100 site

| Servis | Tier | Tahmini aylık (USD) |
|--------|------|----------------------|
| Vercel | Pro / Team | ~50–100 |
| Supabase | Pro | ~50–100 |
| Upstash | Paid | ~40–80 |
| QStash | ~1M+ mesaj | ~100–200 |
| **Toplam** | | **~240–480** |

### 4.4 1.000 site

| Servis | Tier | Tahmini aylık (USD) |
|--------|------|----------------------|
| Vercel | Team / Enterprise | ~100–400 |
| Supabase | Pro / Team | ~100–300 |
| Upstash | Paid / dedicated | ~100–200 |
| QStash | Yüksek hacim | ~300–600 |
| **Toplam** | | **~600–1.500** |

### 4.5 10.000 site

Mevcut tek-app + tek DB + QStash/Redis ile **önerilmez**. Tahmini:

| Servis | Not |
|--------|-----|
| Vercel | Enterprise / multi-region |
| Supabase | Sharding veya ayrı projeler; connection pool |
| Upstash | Cluster / birden fazla Redis |
| QStash | Yüksek plan veya kendi kuyruk (SQS/RMQ) |
| **Toplam** | **Birkaç bin USD/ay** + mimari değişiklik |

---

## 5. Ölçek genişlerken yapılması gerekenler

### 5.1 10 → 50 site

- **Yap:** QStash + Upstash ücretli plan; Supabase Pro; Vercel Pro.  
- **İzle:** QStash mesaj limiti, Redis komut sayısı, DB connection / storage.  
- **Opsiyonel:** Rate limit değerlerini (100/dk sync) plana göre gözden geçir.

### 5.2 50 → 100–200 site

- **Yap:** DB indeksleri (site_id, created_at, status); partition (zaten aylık var) kontrol.  
- **İzle:** RPC süreleri (`get_command_center_p0_stats_v2`, `get_recent_intents_v2`); Realtime eşzamanlı bağlantı.  
- **Opsiyonel:** Dashboard tarafında polling aralığını 10s’ten 15–30s’e çıkarmak; Redis’te stats TTL/key sayısı.

### 5.3 200 → 500–1.000 site

- **Yap:**  
  - Worker’ı daha büyük batch veya paralel işleyecek şekilde tasarlamak (QStash concurrency).  
  - Kritik RPC’lerde materialized view veya özet tablolar (günlük/haftalık).  
  - Redis’te site bazlı key’leri tek bir “stats” hash’e toplamak veya TTL’i kısaltmak.  
- **İzle:** Supabase connection limit; Vercel function timeout; QStash gecikme ve DLQ.

### 5.4 1.000 → 10.000 site

- **Mimari:**  
  - **Kuyruk:** QStash yerine veya yanında SQS / RabbitMQ / Kafka (özellikle worker tarafı).  
  - **DB:** Site/tenant bazlı sharding veya ayrı read replica; büyük RPC’ler için özet tablolar.  
  - **Redis:** Cluster veya site gruplarına göre birden fazla Redis.  
  - **API/Dashboard:** Caching (CDN / Redis) for stats; site listesi ve dropdown’lar için sayfalama.  
- **Güvenlik / limit:** Rate limit’i site bazlı veya tenant bazlı yapmak; abuse önleme.

---

## 6. Özet tablo (100 ziyaret/site/gün)

| Site sayısı | Kabaca dayanır mı? | Tahmini aylık maliyet (USD) | Önerilen aksiyon |
|-------------|---------------------|-----------------------------|-------------------|
| 10 | Premium ile evet | 60–80 | Pro/paid planlar |
| 50 | Evet | 110–240 | Limit + DB izleme |
| 100 | Evet | 240–480 | İndeks, polling ayarı |
| 1.000 | Dikkatli evet | 600–1.500 | Worker/RPC/Redis iyileştirme |
| 10.000 | Mimari değişiklik gerekir | 2.000+ | Kuyruk/DB/Redis mimarisi |

**“Kaç müşteriye kadar dayanır?”**  
- **Free/Hobby:** ~5–15 site.  
- **Premium (Pro planlar):** 50–200 site rahat; 500–1.000 site planlı ölçekleme ile.  
- **10.000 site:** Mevcut tek-stack ile dayanmaz; ölçeklenmiş mimari ve bütçe gerekir.

**Google’a şu an bir şey göndermiyoruz** ifadesi sadece OCI (offline conversion) tarafını etkiler; yukarıdaki kapasite ve maliyetler ziyaret/sync/event/DB yüküne göredir; OCI açılsa da ek maliyet düşüktür (API çağrıları + script).
