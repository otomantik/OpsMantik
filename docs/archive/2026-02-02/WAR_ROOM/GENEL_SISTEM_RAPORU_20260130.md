# OpsMantik v1 — Genel Sistem Raporu (Analiz + Ürünleşme + Mühendislik)

**Tarih:** 2026-01-30  
**Kapsam:** Mevcut sistem analizi, veritabanı, eksikler, geliştirmeye açık alanlar, ürünleşme yolu, mühendislik olgunluğu.

---

## 1. Mevcut Sistemi Analiz Et

### 1.1 Ne yapıyoruz?

| Katman | Açıklama | Durum |
|--------|----------|--------|
| **Tracking** | Siteye gömülü script (core.js) → Sync API → sessions, events, calls | ✅ Çalışıyor |
| **Auth** | Supabase Auth, OAuth callback, admin/site_members/profiles | ✅ Çalışıyor |
| **Dashboard** | Site bazlı tarih aralığı, KPIs, timeline, intent ledger (lead inbox), realtime pulse | ✅ v2.1 tamamlandı |
| **Casino Kasa** | HunterCard v3, SealModal, POST /api/calls/[id]/seal, sale_amount/currency, RLS | ✅ GO1+GO2+GO2.1 bitti |
| **Admin** | Admin sites listesi, site oluşturma, davet, OCI export, auto-approve job | ✅ Var |
| **Multi-tenant** | sites, site_members, profiles, RLS (owner/editor/viewer/admin) | ✅ Var |

### 1.2 Hangi aşadayız?

- **Ürün aşaması:** MVP+ (Minimum Viable Product’ın ötesinde; core flow + satış mühürleme çalışır).
- **Proje aşaması:** PRO Dashboard Migration v2.1 (7 faz) + Casino Kasa (GO1, GO2, GO2.1) tamamlandı.
- **Sıradaki net hedefler:** Phase 1 (RPC contract bölme), Phase 4 (Breakdown widget), production deploy.

---

## 2. Veritabanı Analizi

### 2.1 Tablolar (özet)

| Tablo | Amaç | Partition | RLS |
|-------|------|-----------|-----|
| **sites** | Multi-tenant site tanımı, user_id, domain, name, config (jsonb) | Hayır | ✅ |
| **profiles** | Kullanıcı rolü (user/admin) | Hayır | ✅ |
| **site_members** | Site üyelikleri (owner/editor/viewer) | Hayır | ✅ |
| **sessions** | Ziyaret oturumları, site_id, gclid/wbraid/gbraid, created_month | ✅ Aylık | ✅ |
| **events** | Event kayıtları, session_id, url, event_*, metadata | ✅ Aylık | ✅ |
| **calls** | Telefon/WhatsApp/form intent, matched_session_id, status, sale_amount, oci_status, intent_* | Hayır | ✅ |
| **user_credentials** | OAuth token’ları (Google Ads vb.) | Hayır | ✅ |

### 2.2 Veritabanında ne var, ne eksik?

**Var olanlar (güçlü):**

- Partition (sessions, events) + pg_cron ile aylık partition oluşturma.
- RLS: sites, profiles, site_members, sessions, events, calls — owner/member/admin ayrımı.
- calls: sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, oci_status, intent_action, intent_target, intent_stamp, click_id vb.
- sites: config (jsonb), assumed_cpc, currency.
- RPC’ler: dashboard stats (KPI, ads_only), timeline, intents (get_recent_intents_v1/v2), session timeline, admin_sites_list.
- Index’ler: site_id, created_month, intent_stamp, oci_status vb.
- Trigger’lar: calls güncellemede sadece izinli kolonlar; updated_at; profiles/site_members tetikleyicileri.

**Eksik veya zayıf (geliştirmeye açık):**

| Konu | Durum | Öneri |
|------|--------|--------|
| **Audit log** | Yok | Önemli değişiklikler (seal, status update) için audit tablosu veya event sourcing isteğe bağlı. |
| **Soft delete** | Yok | sites/calls için is_archived veya deleted_at isteğe bağlı. |
| **Rate limit / quota** | DB seviyesinde yok | API’de rate-limit var; tenant bazlı quota (aylık event limiti) ileride eklenebilir. |
| **Backup / point-in-time** | Supabase tarafı | Supabase PITR varsa kullanılır; dokümante edilmeli. |
| **Büyük tablo bakımı** | Partition + pg_cron var | VACUUM ANALYZE stratejisi (partition bazlı) dokümante edilmeli. |

**Özet:** Veritabanı MVP+ ve ürünleşme için **yeterli**. Eksikler çoğunlukla “nice-to-have” (audit, soft delete, tenant quota).

---

## 3. Geliştirmeye Açık Alanlar

### 3.1 Öncelikli (ürünleşmeye yakın)

| Alan | Açıklama | Tahmini |
|------|----------|--------|
| **Phase 1 — RPC contract** | Monolithic stats yerine specialized RPC’ler (timeline, intents, breakdown); bakım ve performans | Orta |
| **Phase 4 — Breakdown widget** | Kaynak/cihaz/şehir breakdown UI; veri zaten RPC’lerde olabilir | Orta |
| **Production deploy** | Ortam değişkenleri, CORS, domain, SSL, Supabase proje ayrımı (prod/staging) | Kısa |
| **Env doğrulama** | Uygulama başlarken gerekli env’lerin varlığı (NEXT_PUBLIC_*, SUPABASE_*, ALLOWED_ORIGINS) | Kısa |

### 3.2 Orta vadeli (ürün kalitesi)

| Alan | Açıklama |
|------|----------|
| **Unit test** | package.json’da test framework yok; Vitest/Jest + kritik hook/utils testleri |
| **E2E test** | Playwright devDependency var ama script yok; login → dashboard → seal akışı |
| **Hata izleme** | Sentry vb. yok; console.error ile sınırlı; prod’da merkezi log/hata takibi |
| **Monitoring / health** | Realtime pulse var; API health endpoint, uptime, basit metrikler |
| **Timeline chart** | SVG-based; Recharts (veya benzeri) production için önerilir |

### 3.3 İsteğe bağlı (ileri geliştirme)

| Alan | Açıklama |
|------|----------|
| **Event batching** | Realtime yüksek hacimde event batch’leme |
| **Offline queue** | Tank Tracker var; tam offline form/action kuyruğu |
| **Export** | CSV/Excel export (intent listesi, KPI özeti) |
| **Bulk actions** | Intent ledger’da çoklu status update / seal |
| **Hunter AI (FAZ 2)** | Boru hattı hazır; AI skorlama/etiketleme sonraki adım |
| **Tenant quota** | Site bazlı aylık event/intent limiti |

---

## 4. Ürünleşmeye Giden Yolda Neredeyiz?

### 4.1 Ürünleşme kriterleri (kısa checklist)

| Kriter | Durum | Not |
|--------|--------|-----|
| **Core flow çalışıyor** | ✅ | Tracking → dashboard → intent → seal |
| **Multi-tenant güvenli** | ✅ | RLS + validateSiteAccess + scrubber |
| **Kritik API’ler güvenli** | ✅ | Seal API: admin lookup, validateSiteAccess, RLS update |
| **Build stabil** | ✅ | npm run build geçiyor |
| **Smoke testler** | ✅ | casino-ui-proof, tank-tracker, v2_2, vb. script’ler var |
| **Dokümantasyon** | ✅ | WAR_ROOM, REPORTS, EVIDENCE, PROOF PACK |
| **Production env** | ⚠️ | Manuel; env, CORS, domain netleştirilmeli |
| **Test (unit/E2E)** | ❌ | Framework/script yok |
| **Hata izleme** | ❌ | Sentry vb. yok |
| **Resmi SLA/backup dokümanı** | ❌ | İsteğe bağlı |

### 4.2 Ürünleşme yolu özeti

- **Şu an:** MVP+; “çalışan ürün” seviyesinde — müşteriye demo verilebilir, tek site/az site ile canlı kullanılabilir.
- **Production “tam hazır” için:** Deploy adımlarının netleşmesi, isteğe bağlı env doğrulama, (tercihen) temel E2E + hata izleme.
- **Ölçeklenmiş ürün için:** Phase 1 (RPC), Phase 4 (breakdown), test otomasyonu, monitoring, tenant quota (gerekirse).

---

## 5. Mühendislik Olgunluğu

### 5.1 Güçlü yanlar

| Alan | Değerlendirme |
|------|----------------|
| **Mimari** | Net katmanlar: tracking → API → DB; dashboard → hooks → RPC; RLS + server gate + scrubber. |
| **Güvenlik** | RLS her tabloda; service role sadece server; client’tan site_id kabul edilmiyor (Seal API); validateSiteAccess tutarlı kullanılıyor. |
| **Veri bütünlüğü** | Partition, constraint (CHECK), trigger (calls güncelleme kısıtı), unique (intent_stamp). |
| **Dokümantasyon** | WAR_ROOM, REPORTS, EVIDENCE, PROOF PACK, STATUS (regression kuralları); raporlama ve kanıt takibi iyi. |
| **Script’ler** | Smoke script’ler (30+), verify/check script’leri; manuel test ve doğrulama için altyapı var. |
| **Versiyonlama** | Migration’lar sıralı (48 dosya); db push ile uygulanabiliyor. |

### 5.2 Zayıf veya eksik yanlar

| Alan | Durum | Öneri |
|------|--------|--------|
| **Otomatik test** | Unit/E2E yok; Playwright kurulu ama script yok | Vitest/Jest + Playwright script; kritik path’ler için E2E (login → seal). |
| **CI/CD** | GitHub Actions vb. net değil | Build + lint + (isteğe bağlı) smoke; deploy adımı dokümante. |
| **Hata izleme** | Sadece console | Sentry (veya benzeri) prod için. |
| **Monitoring** | Dashboard içi realtime pulse var; sistem seviyesi yok | Health endpoint, basit uptime/metric. |
| **Env yönetimi** | .env.local.example boş; hangi env’lerin zorunlu olduğu dağınık | .env.local.example doldurulmalı; uygulama başlangıcında env validate (opsiyonel). |

### 5.3 Olgunluk özeti

- **Seviye:** “Gelişmiş MVP / erken ürün” — mühendislik pratikleri (güvenlik, mimari, dokümantasyon, migration) iyi; otomasyon (test, CI/CD, monitoring) sınırlı.
- **Ürünleşme:** Tekil veya az sayıda müşteri için **hazır**; çok sayıda tenant ve SLA beklentisi için test + monitoring + deploy standardizasyonu eklenmeli.

---

## 6. Özet Tablo

| Soru | Cevap |
|------|--------|
| **Neler yapıyoruz?** | Tracking, dashboard (KPIs, timeline, intent ledger), realtime, Casino Kasa (SEAL DEAL), multi-tenant, admin. |
| **Hangi aşadayız?** | MVP+; PRO Dashboard v2.1 + Casino Kasa (GO1+GO2+GO2.1) tamamlandı. |
| **Veritabanı eksik mi?** | Core için hayır; audit log, soft delete, tenant quota isteğe bağlı geliştirme. |
| **Geliştirmeye açık alanlar?** | Phase 1 (RPC), Phase 4 (breakdown), deploy, test, monitoring, hata izleme, env doğrulama. |
| **Ürünleşmeye giden yolda neredeyiz?** | Çalışan ürün; demo ve sınırlı canlı kullanım için hazır; tam production için deploy + test + monitoring önerilir. |
| **Mühendislik olgunluğu?** | Mimari ve güvenlik iyi; dokümantasyon ve script’ler güçlü; otomatik test ve CI/CD/monitoring geliştirilmeli. |

---

## 7. Referanslar

| Doküman | Konu |
|---------|------|
| `docs/WAR_ROOM/SISTEM_RAPORU_20260130.md` | Kısa durum + yol haritası |
| `docs/WAR_ROOM/CURRENT_STATUS_REPORT.md` | PRO Dashboard v2.1 faz detayı |
| `docs/WAR_ROOM/REPORTS/GO1_GO2_CASINO_KASA_RAPORU.md` | Casino Kasa özeti |
| `docs/WAR_ROOM/STATUS.md` | Regression kuralları (non-negotiables) |
| `docs/WAR_ROOM/DEPLOY_STATUS.md` | Deploy durumu ve manuel adımlar |

---

## 8. Senior EM Şerhleri ve Stratejik Yönlendirme

*Bu bölüm, raporun "Senior Engineering Manager" masasına gelmesi ve onaylanması sonrası eklenen şerhler ve stratejik yönlendirmedir. Durum tespiti dürüst ve teknik olarak isabetli kabul edildi; "Test yoksa yok" — olgunluğun işareti.*

### 🏆 8.1 Neleri Çok Sevdik? (The Good Parts)

| Alan | Yorum |
|------|--------|
| **Mimari disiplin (Architecture Discipline)** | Tracking (Core.js) → API (Sync) → DB (Partitioned) akışı örnek alınacak. Sessions ve events partition + pg_cron ile yönetim, "Bu sistem büyüdüğünde patlamasın" vizyonunun kanıtı. |
| **Güvenlik paranoyası (Security First)** | RLS kullanımı ve site_id'yi client'tan kabul etmeme (Seal API düzeltmesi) çok iyi. Multi-tenant'ta veri sızıntısı (Data Leak) en büyük kabus; kapı kilitli. |
| **Ürün odaklılık (Product Mindset)** | Sadece kod değil; "Casino Kasa" ve "HunterCard" ile satışa dokunan, parayı takip eden değer üretildi. Mühendislik, iş değerine (Business Value) hizmet etti. |

### 🚨 8.2 Kırmızı Alarmlar (Production için)

Raporda "Zayıf/Eksik" denilen yerler, **gerçek SLA** verildiğinde baş ağrıtır:

| Konu | Rapordaki ifade | EM yorumu | Aksiyon |
|------|-----------------|-----------|--------|
| **Observability (Gözlemlenebilirlik)** | "Sentry yok, Monitoring yok." | Kör uçuş. Sync API gece 03:00'te patlarsa müşteri sabah 09:00'da arayana kadar haberimiz olmaz. | **KRİTİK.** Sentry (veya GlitchTip) Phase 1'den bile önce. "Hata varsa, önce ben bilmeliyim." |
| **Test otomasyonu** | "Smoke var ama E2E/Unit yok." | Scriptler iyi başlangıç; CI/CD'de her PR'da çalışan Playwright seti regression korkusunu bitirir. Şu an her deploy rus ruleti. | Playwright seti; kritik path (login → dashboard → seal) E2E. |
| **Soft delete** | "İsteğe bağlı." | B2B SaaS'ta isteğe bağlı değil. Müşteri yanlışlıkla sildiğinde manuel SQL yazmak istemeyiz. | deleted_at (veya is_archived) hayat kurtarır; sites/calls için planlanmalı. |

### 🗺️ 8.3 Stratejik Yol Haritası (Sıra Önerisi)

| Sıra | Blok | Gerekçe |
|------|------|--------|
| **1. Operation Watchtower (Hemen)** | Sentry entegrasyonu; middleware'de basit loglama; `/api/health` endpoint | Kör uçuşu bitir; hata ve sağlık görünür olsun. |
| **2. Phase 4 (Breakdown)** | Kaynak/cihaz/şehir breakdown widget | Ürünü "tamamlanmış" hissettirir; müşteri grafikleri sever. |
| **3. Phase 1 (RPC)** | Monolithic stats → specialized RPC bölme | Sona saklanabilir. Sistem çalışıyorsa performansı müşteri sayısı artınca düşünürüz. "Premature Optimization" yapmayalım. |

### 📝 8.4 Karar (Verdict)

| Madde | Değer |
|-------|--------|
| **DURUM** | **READY FOR BETA** (Beta için hazır) |
| **ONAY** | ✅ Bu rapor arşivlendi; "anayasa" olarak kabul edildi. Nereye koşacağımız belli. |

### ⏭️ 8.5 Sıradaki Hamle

**Seçenekler:**

1. **Operation Watchtower** — Observability önce: Sentry, health endpoint, basit loglama. *EM oyu: Watchtower.*
2. **Phase 4 (Breakdown)** — UI/UX: Breakdown widget'ları; ürünü "tamamlanmış" hissettirir.

**Öneri:** Watchtower ile başlamak. Kör uçuşu bitirmeden yeni özellik eklemek riski artırır; hata varsa önce görmek, sonra grafik zenginleştirmek mantıklı. Patron kararı: Watchtower mı, Breakdown mı?

---

**Rapor tarihi:** 2026-01-30  
**Hazırlayan:** Sistem analizi (Cursor)  
**Şerh / Strateji:** Senior EM onayı ve ek şerhler (Annotations & Strategic Direction) eklendi.
