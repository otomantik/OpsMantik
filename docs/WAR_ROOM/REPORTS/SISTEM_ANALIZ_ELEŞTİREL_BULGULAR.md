# Sistem Analizi — Eleştirel Bulgular

**Tarih:** 2026-01-30  
**Kapsam:** app, components, lib, API, Supabase, güvenlik, mimari.

---

## 1. Kritik (P0)

### 1.1 Rate limit bellekte — production’da yanlış

- **Yer:** `lib/rate-limit.ts`
- **Sorun:** In-memory store; çok instance / serverless’ta paylaşılmıyor. DDoS veya yoğun trafikte limit etkisiz.
- **Öneri:** Production’da Redis (veya Vercel KV / Upstash) ile merkezi rate limit.

### 1.2 Service role (adminClient) çok yerde kullanılıyor

- **Yer:** `call-event`, `sync`, `debug/realtime-signal`, `oci/export`, `jobs/auto-approve`, `intents/[id]/status`, `sites/[id]/status`, `customers/invite`, `create-test-site`, `sites/create`
- **Sorun:** RLS bypass; bir bug tüm veriye erişim riski. `call-event` ve `sync` dışındaki route’larda önce `validateSiteAccess` / `requireSiteAccess` ile yetki, sonra mümkünse anon key + RLS tercih edilmeli.
- **Öneri:** adminClient sadece “sistem” işleri (sync, call-event, cron) için; kullanıcı aksiyonları için server client + RLS.

### 1.3 Middleware yok — route koruması dağınık

- **Sorun:** `middleware.ts` yok. `/dashboard`, `/admin`, `/api/*` koruması her sayfa/route’ta ayrı ayrı (getUser, validateSiteAccess, isAdmin). Unutulan bir sayfa doğrudan erişime açık kalabilir.
- **Öneri:** Auth middleware ile `/dashboard/*`, `/admin/*` ve hassas API route’ları tek yerden koru; 401/403 redirect.

### 1.4 `/test-page` production’da açık

- **Yer:** `app/test-page/page.tsx`
- **Sorun:** Tracker test sayfası; NODE_ENV kontrolü yok. Canlıda `/test-page` herkese açık, event enjeksiyonu / bilgi sızıntısı riski.
- **Öneri:** Route’u dev’e kıs (middleware veya `next.config` redirect) ya da tamamen kaldır.

---

## 2. Yüksek (P1)

### 2.1 Client’ta doğrudan `.from()` — RLS’e güven

- **Yerler:** `session-drawer.tsx` (events), `session-group.tsx` (calls), `site-switcher`, `sites-manager`, `CommandCenterP0Panel` (sites), `use-intent-qualification` (calls), `use-visitor-history` (calls)
- **Sorun:** RLS doğru değilse veya policy hatası olursa veri sızabilir. Client’ta anon key ile doğrudan tablo erişimi.
- **Öneri:** Hassas veri için RPC kullan (örn. `get_session_events`); client sadece RPC çağırsın.

### 2.2 `create-test-site` — site sahipliği kontrolü yok

- **Yer:** `app/api/create-test-site/route.ts`
- **Sorun:** Giriş yapmış herkes bir site “oluşturuyor” (veya mevcut site dönüyor). Site limiti / abuse kontrolü yok.
- **Öneri:** En azından site sayısı limiti veya sadece belirli roller (örn. admin) için aç.

### 2.3 Dashboard iki katman: dashboard/ vs dashboard-v2/

- **Sorun:** `dashboard/` (site-setup, sites-manager, site-switcher, month-boundary-banner) ve `dashboard-v2/` (DashboardShell, QualificationQueue, HunterCard) birlikte kullanılıyor. Tek dashboard konsepti yok; bakım maliyeti ve tutarsız UX riski.
- **Öneri:** Tek “dashboard” soyutlaması; v2’yi tek kaynak kabul edip eski bileşenleri kademeli kaldır veya v2 altında topla.

### 2.4 `.env.local.example` boş

- **Sorun:** Yeni geliştiriciler hangi env’lerin gerekli olduğunu dosyadan göremiyor.
- **Öneri:** Örnek key’ler (placeholder) ile doldur; README’de env kurulumu anlat.

---

## 3. Orta (P2)

### 3.1 API route’larda hata mesajları tutarsız

- **Sorun:** Kimi route `{ error: string }`, kimi `{ ok: false, message }`, kimi farklı alanlar. Client tarafında tek tip işleme zor.
- **Öneri:** Ortak API response şeması (örn. `{ success, data?, error?, code? }`) ve tutarlı HTTP status kullanımı.

### 3.2 Sync route çok büyük

- **Yer:** `app/api/sync/route.ts` (çok satır)
- **Sorun:** Tek dosyada çok mantık; test ve bakım zor.
- **Öneri:** Sync’i modüllere böl (validation, session upsert, event/call işleme); route sadece orkestrasyon.

### 3.3 Type safety — `any` kullanımı

- **Yerler:** RPC cevapları, event metadata, bazı hook’lar `as any` veya `any[]`.
- **Sorun:** Refactor’da sessiz kırılma riski.
- **Öneri:** Supabase generate types; RPC/event için net interface’ler.

### 3.4 Debug header’lar production’da

- **Yer:** `call-event` route — `X-OpsMantik-Version`, `X-CORS-Status`, `X-CORS-Reason` vb.
- **Sorun:** Bilgi sızıntısı riski düşük ama gereksiz; saldırgan için ipucu olabilir.
- **Öneri:** Production’da bu header’ları kaldır veya sadece internal/health check’te kullan.

---

## 4. Düşük / İyileştirme (P3)

### 4.1 Smoke / proof script’leri dağınık

- **Sorun:** Birçok `scripts/smoke/*` ve `scripts/*.mjs`; hangisinin ne zaman çalıştığı net değil.
- **Öneri:** Tek `npm run smoke` ile kritik senaryoları sırayla çalıştır; diğerleri alt komut veya CI’da ayrı adım.

### 4.2 Docs vs kod gerçeği

- **Sorun:** Silinen component’lere (IntentLedger, ConversionTracker, TrackedEventsPanel) docs’ta hâlâ referans var. Eski raporlar güncel değil.
- **Öneri:** Ana README ve API_CONTRACT güncel tut; eski raporları “tarihsel” diye işaretle veya archive’a taşı.

### 4.3 Eski dashboard component’leri hâlâ duruyor

- **Yer:** `components/dashboard/` — session-drawer, session-group, realtime-pulse, timeline-chart, breakdown-widget, confidence-score, intent-status-badge, intent-type-badge, date-range-picker, health-indicator, month-boundary-banner, site-setup, site-switcher, sites-manager
- **Sorun:** Bunların bir kısmı sadece `/dashboard` (liste) sayfasında; site detay (Hunter Terminal) v2. Kullanılmayanlar varsa dead code.
- **Öneri:** Import/call graph ile kullanılmayanları tespit et; kullanılanları v2 ile tek çatıda topla.

---

## 5. Özet tablo

| Öncelik | Konu | Aksiyon |
|--------|------|--------|
| P0 | Rate limit in-memory | Production’da Redis/KV |
| P0 | adminClient kullanımı | Sadece sistem route’ları; kullanıcı aksiyonları RLS |
| P0 | Middleware yok | Auth middleware ile dashboard/admin koruma |
| P0 | /test-page açık | Dev’e kıs veya kaldır |
| P1 | Client .from() | Hassas veri için RPC |
| P1 | create-test-site | Limit / rol kontrolü |
| P1 | İki dashboard katmanı | Tek dashboard stratejisi |
| P1 | .env.example boş | Örnek env dokümante et |
| P2 | API response formatı | Ortak şema |
| P2 | Sync route büyük | Modüllere böl |
| P2 | any / type | RPC/event tipleri |
| P3 | Smoke script’leri | Tek smoke runner |
| P3 | Eski dashboard component’leri | Kullanım analizi + temizlik |

---

## 6. Veri (kısa)

- **Supabase kullanımı:** ~38 dosyada createClient/adminClient; 62+ doğrudan `.from()` çağrısı.
- **Env kullanımı:** 20 dosyada process.env; NEXT_PUBLIC_ ve SUPABASE_SERVICE_ROLE yaygın.
- **API route’lar:** call-event (CORS + rate limit), sync (adminClient ağır), debug (prod’da 404), diğerleri auth/site kontrolü ile değişken.
- **Auth:** Cookie-based (Supabase SSR); merkezi middleware yok.

Bu rapor canlı öncesi P0 maddelerinin kapatılmasını önerir; P1/P2 kademeli plana alınabilir.
