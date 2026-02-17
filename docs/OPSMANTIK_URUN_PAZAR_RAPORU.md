# OpsMantik — Ürün ve Pazar Raporu

**Tarih:** Şubat 2026  
**Kapsam:** Sistem tanımı, ürün puanı, rakipler ve yakın ürünler.  
**Dil:** Türkçe.

---

## 1) İşin Başı: Sistem Nedir?

**OpsMantik**, Google Ads odaklı **attribution (atıf) ve lead intelligence** platformudur. Temel değer önerisi:

- **Gerçek zamanlı event/session takibi** — Sitedeki ziyaretçi davranışı (tıklama, scroll, arama, arama/WhatsApp tıklaması) tek bir pipeline’da toplanır.
- **Multi-touch attribution** — Trafiğin kaynağı GCLID/UTM/parmak izi ile sınıflandırılır (S1–S5 hiyerarşisi: GCLID → UTM paid → Ads Assisted → Paid Social → Organic).
- **Lead skorlama (0–100)** — Davranış sinyallerine göre anlık lead skoru hesaplanır (primary conversion +50, scroll/hover/Google referrer vb. ağırlıklı).
- **Arama (call) eşlemesi** — Telefon/WhatsApp tıklaması veya harici arama kaydı, parmak izi ile mevcut session’a bağlanır; conversion olarak işaretlenir.
- **Offline conversion hazırlığı** — Satış onaylandığında (conversation/sales layer) satış, GCLID/wbraid/gbraid ile kuyruğa alınır; Google Ads Offline Conversion Import (OCI) için export/claim ile dış worker’a sunulur.
- **Çok kiracılı (multi-tenant) SaaS** — Site bazlı izolasyon, RLS, plan/kota, faturalandırma otoritesi (ingest_idempotency) ve mutabakat (reconciliation) ile çalışır.

Yani ürün: **reklam tıklamasından, sitedeki davranışa, arama/conversion’a ve (kuyruk üzerinden) offline conversion yüklemesine kadar** olan zinciri tek platformda toplar; dashboard’da “WAR ROOM” ile session/event/call ve attribution görüntülenir.

---

## 2) Mimari ve Akış (Özet)

| Katman | Teknoloji | Rol |
|--------|-----------|-----|
| Frontend | Next.js 16, React 19, shadcn/ui, Recharts | Dashboard, site/session/activity, login |
| API | Next.js API Routes | /api/sync, /api/call-event, /api/sales, /api/conversations, cron’lar, OCI export |
| Kuyruk | Upstash QStash | Sync event’leri async işleme |
| Veritabanı | Supabase (PostgreSQL) | sessions/events (aylık partition), calls, ingest_idempotency, site_plans, site_usage_monthly, conversations, sales, offline_conversion_queue |
| Cache / limit | Upstash Redis | Rate limit, kota sayacı (billing otoritesi Postgres’te) |
| Auth | Supabase Auth + Google OAuth | Giriş; site sahipliği + site_members + admin (RBAC) |
| İzleme | Watchtower cron, GET /api/metrics | Billing drift, session vitality, ingest hataları |

**Veri akışı (kısaca):**

1. **Tracking:** Siteye gömülen `core.js` (neutral path, reklam engelleyici dostu) URL’den gclid/wbraid/gbraid ve UTM’i okur, session/event’leri `POST /api/sync` ile gönderir.
2. **Sync pipeline:** Auth → Rate limit → Idempotency (Postgres) → Quota → Publish (QStash) veya fallback buffer; DB hata = 500 (publish yok); duplicate = 200 + dedup.
3. **Call-event:** `POST /api/call-event/v2` ile telefon/WhatsApp veya harici arama, fingerprint ile session’a eşleştirilir.
4. **Conversation/Sales:** Conversation oluşturulur, satış kaydı (DRAFT → CONFIRMED) ve `confirm_sale_and_enqueue` ile offline_conversion_queue’ya tek satır eklenir; GCLID/wbraid/gbraid conversation primary_source’tan gelir.
5. **OCI:** Kuyruktan job’lar claim edilir; Google Ads’e yükleme repoda yok (export/CSV veya dış worker ile yapılır). PR7 ile backlog-weighted fair share ve performans iyileştirmeleri eklendi.
6. **Faturalandırma:** Otorite `ingest_idempotency` (billable=true); reconciliation cron ile `site_usage_monthly` güncellenir; invoice freeze ve dispute export mevcut.

---

## 3) Özellik Listesi (Ürün Yönüyle)

| Alan | Özellik | Durum |
|------|---------|--------|
| Tracking | Real-time event/session, GCLID/wbraid/gbraid + UTM tam şablon | Var |
| Tracking | Browser fingerprinting, session persistence | Var |
| Attribution | S1–S5 (GCLID, UTM paid, Ads Assisted, Paid Social, Organic) | Var |
| Lead | 0–100 lead skoru, davranış sinyallerine göre | Var |
| Call | Arama/WhatsApp eşlemesi (call-event), signature ile güvenlik | Var |
| Conversation | Conversation + link (call/session/event), WON/LOST/JUNK | Var |
| Sales | Sales CRUD, confirm, idempotency (external_ref) | Var |
| OCI | Kuyruk (enqueue, claim), attribution backfill (late linking) | Var (upload product dışı) |
| Dashboard | Site listesi, site bazlı WAR ROOM, tarih aralığı (TRT günü varsayılan) | Var |
| Dashboard | Session grupları, event timeline, call eşlemesi, attribution_source | Var |
| Dashboard | Activity log (event/session detay) | Var |
| Billing | Plan/kota, ingest_idempotency SoT, reconciliation, drift eşiği | Var |
| Billing | Invoice freeze, dispute export (CSV, snapshot_hash) | Var |
| Ops | Watchtower, /api/metrics, release runbook, cron auth | Var |
| Ölçek | sessions/events aylık partition; ingest_idempotency partition yok (runbook ile ertelendi) | Kısmi |
| Uyumluluk | Consent, right-to-erasure, DPA, audit log | Yok |

---

## 4) Ürün Puanı (0–100)

Aşağıdaki boyutlar **ürün olarak** değerlendirilmiş; teknik denetim puanları (audit raporları) ile uyumlu tutulmuştur.

| Boyut | Ağırlık | Puan (0–100) | Kısa gerekçe |
|-------|---------|--------------|--------------|
| Değer önerisi / ürün-market fit | 20% | 78 | Google Ads + lead + call + offline conversion tek pakette; OCI upload ürün içi değil, SMB/ajans için net senaryo var. |
| Özellik bütünlüğü | 20% | 72 | Tracking → attribution → lead → call → conversation → sales → queue tamam; dashboard canlı; eksik: in-app OCI upload, consent/erasure. |
| Teknik sağlamlık | 15% | 76 | Fail-secure billing, idempotency, RLS, reconciliation, dispute export; partition/ölçek ve metrics persistence kısıtları var. |
| Güvenlik ve çok kiracılık | 15% | 80 | RLS, CORS fail-closed, cron auth, tenant-scoped API; conversation link cross-site validasyonu ve audit log eksik. |
| Operasyonel olgunluk | 10% | 70 | Watchtower, runbook, smoke testler; SLO/formal alerting ve tam otomatik recovery sınırlı. |
| Ölçeklenebilirlik / veri yaşam döngüsü | 10% | 58 | Partition sessions/events; ingest_idempotency partition yok; cleanup batch var. |
| Uyumluluk (KVKK/GDPR) | 10% | 35 | Consent, silme hakkı, DPA yok; parmak izi toplanıyor. |

**Ağırlıklı toplam:**

- (78×0,20) + (72×0,20) + (76×0,15) + (80×0,15) + (70×0,10) + (58×0,10) + (35×0,10)  
- = 15,6 + 14,4 + 11,4 + 12 + 7 + 5,8 + 3,5 = **69,7**

**Ürün puanı: 70/100** (yuvarlanmış).

**Özet:** Güçlü taraflar: net değer önerisi, attribution/lead/call/queue hattı, finansal determinizm ve tenant izolasyonu. Zayıf taraflar: OCI’ın ürün içinde kapatılmaması, compliance (consent/erasure/audit) ve ölçek (ingest partition) eksiklikleri.

---

## 5) Yakın Ürünler ve Rakipler

Aşağıdaki tablo, **Google Ads attribution, call tracking, offline conversion, lead skorlama** alanında bilinen rakipler ve “yakın ürünler” özetidir. Pazar araştırması (2024–2025) ve genel bilgilere dayanır; fiyatlar değişebilir.

### 5.1 Doğrudan / Yakın Rakipler

| Ürün | Odak | Google Ads / OCI | Call tracking | Lead / attribution | Fiyat (tahmini) | OpsMantik’e göre fark |
|------|------|-------------------|---------------|---------------------|------------------|------------------------|
| **CallRail** | Arama takibi, attribution | Entegrasyon, keyword/numara | Evet (5 numara, dakika paketi) | Form + arama | $45–175/ay | Daha çok “numara + dakika” odaklı; OpsMantik session/event/lead skoru daha zengin. |
| **CallTrackingMetrics (CTM)** | Arama + metin + attribution | Google Ads / GA4 entegrasyonu | Evet, AI transkript | Form, arama, metin | $65–330/ay, Enterprise $1.999 | Tam call center tarafı güçlü; OpsMantik daha çok “site + GCLID + queue” odaklı. |
| **WhatConverts** | Arama, form, sohbet, işlem | Marketing source attribution | Arama, form, sohbet | Çok kanallı attribution | Özelleştirilir | Genel “conversion” odaklı; OpsMantik conversation/sales/queue ve billing kernel ile farklılaşır. |
| **Ruler Analytics** | B2B arama, offline attribution | Offline conversion, CRM | Arama odaklı | Çok dokunuşlu attribution | ~$199/ay | OpsMantik ile benzer “offline conversion” hikâyesi; OpsMantik’te conversation/sales/queue ve billing altyapısı var. |
| **AnyTrack** | Conversion tracking, CAPI | Google, Meta, TikTok CAPI | Sınırlı | No-code, server-side | Deneme + ücretli | Daha çok “veri besleme”; OpsMantik event/session/lead/call tek platformda. |
| **Hyros** | Yüksek biletli, karma funnel | Çok kanallı | — | AI multi-touch | ~$500/ay | Daha enterprise; OpsMantik daha çok Google Ads + SMB/ajans. |
| **Northbeam** | DTC, medya karışımı | ML attribution | — | ML/MMM | ~$1.000/ay | OpsMantik daha basit, fiyat/kompleksite daha düşük hedefli. |
| **Triple Whale** | E-ticaret (Shopify) | Kâr odaklı | — | Real-time kâr | $129–799/ay | E-ticaret odaklı; OpsMantik genel lead/call/offline conversion. |
| **Attribution IQ** | Attribution (UK) | Ziyaret bazlı limit | — | Attribution | £100–250/ay | OpsMantik’te call/session/queue ve billing var. |
| **Bread & Butter** | Lead intelligence | — | — | AI lead | $0–49/site | Sadece lead tarafı; OpsMantik full pipeline. |

### 5.2 OpsMantik’in Konumu (Özet)

- **Benzer olduğu ürünler:** Call tracking + Google Ads attribution + offline conversion hattı ile **Ruler Analytics**, **CallRail**, **WhatConverts** ve **CTM** ile aynı problem alanına giriyor.
- **Farklılaştığı noktalar:**  
  - Tek platformda: **session/event + GCLID/UTM + lead skoru + call eşlemesi + conversation/sales + offline conversion kuyruğu + billing/reconciliation**.  
  - **Revenue kernel** (idempotency SoT, reconciliation, invoice freeze, dispute export) birçok call-tracking üründe bu seviyede yok.  
  - OCI **upload** henüz ürün dışı (export/claim ile dış worker); rakiplerin bir kısmı upload’ı kendi ürününde sunuyor.
- **Hedef kitle:** Google Ads kullanan SMB’ler, ajanslar, offline satışı olan işletmeler (arama + form + satış onayı → OCI).

---

## 6) Eksikler ve Öneriler (Ürün Odaklı)

| Öncelik | Eksik | Öneri |
|---------|--------|--------|
| P0 | OCI upload ürün içinde yok | Google Ads API ile upload’ı ürün içine al veya “resmi” tek dokümanlı upload pipeline (script + cron) sun. |
| P1 | Consent / KVKK-GDPR | Consent API, right-to-erasure endpoint, DPA/audit log planı. |
| P1 | Conversation link cross-site | entity_id’nin aynı site’a ait olduğunu API’de doğrula. |
| P2 | ingest_idempotency partition | Ölçek runbook’taki eşikte partition/BRIN uygula. |
| P2 | SLO / formal alerting | Watchtower’ı SLO ile tamamla, alarm entegrasyonu. |

---

## 7) Sonuç

- **OpsMantik**, Google Ads attribution + lead skoru + arama eşlemesi + conversation/sales + offline conversion kuyruğu + billing/reconciliation ile **tek ürün** sunan bir platform.  
- **Ürün puanı: 70/100.** Güçlü taraflar: değer önerisi, özellik zinciri, finansal ve tenant güvenliği. Zayıf taraflar: OCI’ın ürün içinde kapatılmaması, compliance ve ölçek sınırları.  
- **Rakipler:** Call tracking + attribution alanında CallRail, CTM, WhatConverts, Ruler Analytics doğrudan rakip; AnyTrack, Hyros, Northbeam vb. daha genel attribution/CAPI tarafında. OpsMantik, “site → session → event → call → conversation → sale → OCI queue + billing” bütünlüğü ve revenue kernel ile farklılaşıyor.  
- **Pazar konumu:** SMB ve ajanslar için Google Ads odaklı, offline conversion ve arama takibi isteyen müşterilere uygun; compliance ve in-product OCI upload tamamlandığında puan ve rekabet gücü artar.

---

**Rapor sonu.**  
Referanslar: `README.md`, `docs/ARCH.md`, `docs/API.md`, `docs/AUDIT/OPSMANTIK_SYSTEM_AUDIT_REPORT.md`, `docs/AUDIT/TIER1_BACKEND_AUDIT_2026.md`, `docs/CONVERSATION_LAYER_REPORT.md`, `docs/OPS/GOOGLE_ADS_TRACKING_TEMPLATE.md`, web pazar araştırması (Şubat 2026).
