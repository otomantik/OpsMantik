# OpsMantik v1 — Tam Sistem Raporu

**Tarih:** 2026-01-30  
**Kapsam:** Proje ne yapıyor, işin neredesindeyiz, ne kaldı — analiz ve özet.

---

## 1. Proje Nedir?

**OpsMantik** = Google Ads attribution + lead intelligence platformu.

- **Amaç:** Reklam tıklamaları → site ziyareti → intent (telefon/WhatsApp/form) → dönüşüm hattını takip etmek; müşteriye “Google 130 tıklama diyor, kaçı gerçekten sizinle konuştu?” sorusuna veriyle cevap vermek.
- **Stack:** Next.js 16, Supabase (PostgreSQL + Realtime), Tailwind, shadcn/ui.
- **Kullanıcılar:** Site sahipleri (multi-tenant), admin.

---

## 2. Ne Yapıyoruz? (İş Akışı)

### 2.1 Ana iş akışı (veri boru hattı)

1. **Tracking:** Siteye gömülü script (core.js) → event/call sync API → `sessions`, `events`, `calls`.
2. **Dashboard:** Site bazlı tarih aralığı → KPIs, timeline, intent ledger (lead inbox).
3. **Realtime:** Supabase Realtime ile canlı güncellemeler (KPIs optimistic, chart bounded refresh).
4. **Casino Kasa (Satış mühürleme):** Intent call’a “SEAL DEAL” → sale_amount + currency kaydı → status=confirmed, oci_status=sealed.

### 2.2 Güvenlik katmanları

- **RLS:** Site/session/call izolasyonu (owner, site_members, admin).
- **Server gate:** `validateSiteAccess` (API’lerde).
- **Scrubber:** Cross-site veri maskeleme.

---

## 3. İşin Neredesindeyiz?

### 3.1 Tamamlanan büyük bloklar

| Blok | İçerik | Durum |
|------|--------|--------|
| **PRO Dashboard Migration v2.1** | Phase 0, 2, 3, 5, 6, 7 (audit, Iron Dome, Command Center, Timeline, Intent Ledger, Realtime Pulse) | ✅ 7 faz bitti |
| **SECTOR ALPHA (DB)** | Sessions/events/calls, partition, RLS, RPC’ler, ads_only, KPI/stats | ✅ Canlı |
| **SECTOR BRAVO (Tank Tracker)** | Store & Forward, outbox, partition otomasyonu (pg_cron) | ✅ Canlı |
| **GO1 — Casino Kasa DB** | calls: sale_amount, currency, updated_at; sites.config; RLS/trigger; tipler | ✅ Migration + types |
| **GO2 — Casino UI** | HunterCard v3, SealModal, POST /api/calls/[id]/seal, Bearer auth, useSiteConfig | ✅ UI + API + smoke PASS |
| **GO 2.1 — Seal RLS + API** | calls SELECT (owner/member/admin/viewer), calls UPDATE (owner/editor/admin), sites config UPDATE, admin lookup + validateSiteAccess + user client UPDATE, oci_status | ✅ Migration + Seal API + smoke PASS |

### 3.2 Son yapılan (bu oturum)

- **Seal API 404 (PGRST116) çözümü:** Call lookup artık **admin client** ile (site_id client’tan alınmıyor); erişim `validateSiteAccess`; UPDATE **user client** ile (RLS geçerli). Smoke: `node scripts/smoke/casino-ui-proof.mjs --inject` → **PASS**.
- **Migration’lar:** `20260130210000_go21_seal_rls_oci_status.sql` (calls UPDATE + oci_status), `20260130220000_go21_calls_select_visible.sql` (calls SELECT).
- **Smoke script:** Proof user id, site_id, call site_id, Seal API result loglanıyor.

### 3.3 Mevcut durum özeti

- **Build:** TypeScript derlemesi geçiyor (userClient tip + guard ile).
- **Smoke:** casino-ui-proof --inject PASS (Seal API 200, DB verified).
- **Migration sayısı:** 48 dosya (`supabase/migrations/`).
- **Regression kuralları:** STATUS.md (next/font yok, partition filter, RLS join, service role sadece server, site_members, admin guard) — uyuluyor.

---

## 4. Ne Kadar Kaldı? (Yol Haritası)

### 4.1 Öncelikli / net hedefler

| Hedef | Açıklama | Tahmini |
|-------|----------|---------|
| **Phase 1 — RPC contract** | Monolithic stats yerine specialized RPC’ler (timeline, intents, breakdown) | Orta |
| **Phase 4 — Breakdown widget** | Kaynak/cihaz/şehir breakdown bileşenleri | Orta |
| **Production deploy** | Canlıya deploy, env, CORS, domain | Kısa |
| **GO1/GO2 checklist doldurma** | PROOF_PACK / GO1_GO2_CASINO_KASA_RAPORU.md içindeki maddeleri işaretleme | Kısa |

### 4.2 İsteğe bağlı / iyileştirme

- **Recharts:** Timeline chart için production’da kütüphane kullanımı.
- **Unit/E2E test:** Test framework eklenmesi (şu an yok).
- **Event batching:** Yüksek hacimde realtime için.
- **Offline queue, export (CSV/Excel), bulk actions** intent ledger için.
- **FAZ 2 (Hunter AI):** Son durum raporunda “yeni hedef” olarak geçiyor; boru hattı hazır, AI işleme sonraki adım.

### 4.3 Bakım / operasyon

- **Partition:** pg_cron ile aylık partition oluşturma devrede.
- **Migration:** Yeni migration’lar `npx supabase db push` ile uygulanmalı (GO 2.1 migration’ları dahil).

---

## 5. Analiz ve Özet

### 5.1 Güçlü yanlar

- Veri boru hattı (tracking → DB → dashboard) kurulu ve site/partition/RLS ile izole.
- Dashboard v2.1 (tarih aralığı, KPIs, timeline, intent ledger, realtime) tamamlanmış.
- Casino Kasa (satış mühürleme) DB + UI + API + RLS ile bitmiş; smoke test geçiyor.
- Seal API güvenli: lookup admin, erişim validateSiteAccess, güncelleme RLS’li user client; client’tan site_id kabul edilmiyor.
- Dokümantasyon (WAR_ROOM, REPORTS, EVIDENCE, PROOF PACK) mevcut; raporlama ve kanıt takibi yapılabiliyor.

### 5.2 Dikkat edilecekler

- **Test:** Unit/E2E yok; smoke script’ler ve manuel testlerle ilerleniyor.
- **Deploy:** Git push / canlı ortam için manuel adımlar (DEPLOY_STATUS.md) gerekebilir.
- **Phase 1 / Phase 4:** RPC bölme ve breakdown widget henüz yapılmadı; roadmap’te net.

### 5.3 “Neredeyiz?” cevabı

- **Ürün:** MVP+ seviyesinde; tracking, dashboard, intent ledger ve “SEAL DEAL” (satış mühürleme) çalışır durumda.
- **Casino Kasa (GO1+GO2+GO2.1):** Bitti; smoke PASS, RLS ve API güvenliği uygulanmış.
- **Kalan iş:** Özellikle Phase 1 (RPC), Phase 4 (breakdown), production deploy ve isteğe bağlı iyileştirmeler; kritik bloklar tamamlanmış durumda.

---

## 6. Hızlı Referans

| Ne | Nerede / Komut |
|----|-----------------|
| Durum özeti | `docs/WAR_ROOM/CURRENT_STATUS_REPORT.md` |
| Casino Kasa raporu | `docs/WAR_ROOM/REPORTS/GO1_GO2_CASINO_KASA_RAPORU.md` |
| GO 2.1 proof pack | `docs/WAR_ROOM/EVIDENCE/GO2_1_RLS/PROOF_PACK_SEAL_RLS.md` |
| Regression kuralları | `docs/WAR_ROOM/STATUS.md` |
| Seal smoke | `node scripts/smoke/casino-ui-proof.mjs --inject` |
| Build | `npm run build` |
| Migration push | `npx supabase db push` |

---

**Rapor tarihi:** 2026-01-30  
**Hazırlayan:** Sistem analizi (Cursor)
