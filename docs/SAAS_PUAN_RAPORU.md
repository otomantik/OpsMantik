# OpsMantik — Global ve Türkiye SaaS Puan Raporu

**Tarih:** 17 Şubat 2026  
**Kapsam:** Tüm sistem taraması (kod, dokümantasyon, audit raporları).  
**Referanslar:** OPSMANTIK_SYSTEM_AUDIT_REPORT.md, OPSMANTIK_URUN_PAZAR_RAPORU.md, ARCH.md, TIER1_BACKEND_AUDIT_2026.md, CONVERSATION_LAYER_*, OCI_DURUM_RAPORU.

---

## 1) Tarama Özeti

| Alan | Durum | Kanıt (kısa) |
|------|--------|---------------|
| Multi-tenancy | ✅ | RLS site bazlı; CORS fail-closed; tenant-scoped API (site_id, validateSite). |
| Billing / Revenue kernel | ✅ | ingest_idempotency SoT; reconciliation; invoice freeze; dispute export. |
| Güvenlik | ✅ | Cron auth; vault (credential şifreleme); rate limit + quota + idempotency sırası. |
| OCI (Google Ads) | ✅ | Worker, vault, adapter, test-oci; claim → decrypt → upload → DB güncelleme. |
| Observability | ✅ | Watchtower; /api/metrics; runbook; build-info headers. |
| Ölçek / veri yaşam döngüsü | ⚠️ | Sessions/events partition var; ingest_idempotency partition yok; cleanup batch var. |
| Uyumluluk (KVKK/GDPR) | ❌ | Consent, right-to-erasure, DPA, audit log yok; parmak izi toplanıyor. |
| i18n | ⚠️ | Sadece en.ts; tr.ts yok; UI büyük oranda İngilizce. |
| Para birimi / bölge | ✅ | TRY varsayılan; TRT günü (dashboard tarih aralığı) kullanılıyor. |

---

## 2) Global SaaS Puanı (0–100)

**Tanım:** Çok kiracılı, güvenli, faturalandırılabilir, ölçeklenebilir ve operasyonel olarak olgun bir SaaS olarak evrensel kriterlere göre değerlendirme.

| Kriter | Ağırlık | Puan (0–100) | Gerekçe |
|--------|---------|--------------|--------|
| Multi-tenancy & tenant izolasyonu | 15% | 82 | RLS, CORS, site_id doğrulama, cron auth; cross-tenant sızıntı riski düşük. |
| Finansal determinizm & billing | 15% | 85 | Idempotency SoT, fail-secure 500, reconciliation, invoice freeze, dispute export. |
| Güvenlik (auth, credential, abuse) | 15% | 78 | Supabase Auth, vault, rate limit, quota; consent/erasure eksik. |
| API & entegrasyon olgunluğu | 10% | 75 | Sync, call-event, sales, OCI worker, cron’lar; dokümante; versioning sade. |
| Observability & ops | 10% | 72 | Watchtower, metrics, runbook, SLO_SLA.md; formal SLO/alerting sınırlı. |
| Ölçeklenebilirlik & veri yaşam döngüsü | 10% | 58 | Partition (sessions/events); ingest partition yok; cleanup batch; scaling runbook var. |
| Test & release disiplini | 10% | 70 | Unit testler (revenue kernel, idempotency, quota, OCI); PR gate; E2E kısıtlı. |
| Uyumluluk (GDPR / privacy) | 15% | 38 | Consent, silme hakkı, DPA, audit log yok; puan düşük. |

**Hesaplama (ağırlıklı ortalama):**

- 82×0,15 + 85×0,15 + 78×0,15 + 75×0,10 + 72×0,10 + 58×0,10 + 70×0,10 + 38×0,15  
- = 12,3 + 12,75 + 11,7 + 7,5 + 7,2 + 5,8 + 7 + 5,7 = **61,95**

**Global SaaS puanı: 62/100** (yuvarlanmış).

**Özet:** Güçlü taraflar: çok kiracılık, billing bütünlüğü, güvenlik ve OCI pipeline. Zayıf taraflar: privacy/uyumluluk (consent, erasure, DPA) ve ölçek (ingest partition) eksiklikleri global SaaS beklentisini düşürüyor.

---

## 3) Türkiye SaaS Puanı (0–100)

**Tanım:** Türkiye pazarına uyum: yerel para birimi, dil, zaman dilimi, KVKK uyumu ve yerel pazar ihtiyaçları.

| Kriter | Ağırlık | Puan (0–100) | Gerekçe |
|--------|---------|--------------|--------|
| Para birimi & bölgesel varsayılanlar | 15% | 88 | TRY varsayılan (sales, queue, dashboard); TRT günü (tarih aralığı). |
| Dil & yerelleştirme (UI) | 20% | 40 | Sadece en.ts; tr.ts yok; dashboard ve mesajlar ağırlıklı İngilizce. |
| KVKK / kişisel veri uyumu | 25% | 35 | Açık rıza, silme hakkı, veri işleme sözleşmesi, audit log yok; parmak izi toplanıyor. |
| Pazar uyumu (SMB / ajans / Google Ads) | 20% | 82 | Google Ads + lead + arama + OCI; SMB/ajans senaryosu net; yerel rakiplerle rekabet edebilir. |
| Teknik altyapı (güvenilirlik, güvenlik) | 10% | 76 | Revenue kernel, RLS, vault; Türkiye’de sunucu/veri konumu dokümante değil (Supabase bölge). |
| Destek / dokümantasyon (TR) | 10% | 55 | Birçok doc Türkçe; runbook ve API doc karışık; resmi TR destek kanalı belirsiz. |

**Hesaplama (ağırlıklı ortalama):**

- 88×0,15 + 40×0,20 + 35×0,25 + 82×0,20 + 76×0,10 + 55×0,10  
- = 13,2 + 8 + 8,75 + 16,4 + 7,6 + 5,5 = **59,45**

**Türkiye SaaS puanı: 59/100** (yuvarlanmış).

**Özet:** TRY/TRT ve Google Ads odaklı ürün Türkiye pazarına uyumlu; ancak Türkçe UI eksikliği ve KVKK (açık rıza, silme hakkı, DPA) eksiklikleri Türkiye SaaS puanını aşağı çekiyor.

---

## 4) Karşılaştırma ve Öncelikler

| Metrik | Global SaaS | Türkiye SaaS |
|--------|--------------|---------------|
| **Puan** | **62/100** | **59/100** |
| En güçlü alanlar | Billing, multi-tenancy, güvenlik | Para birimi/TRT, pazar uyumu |
| En zayıf alanlar | Uyumluluk (GDPR), ölçek | KVKK, dil (tr.ts), TR destek |

**Ortak eksikler:** Consent/privacy (GDPR/KVKK), audit log, tam Türkçe UI.

**Önerilen P0/P1 (puanı yükseltmek için):**

1. **KVKK/GDPR:** Consent API, right-to-erasure endpoint, DPA/veri işleme dokümanı → hem Global hem Türkiye puanını artırır.  
2. **Türkçe UI:** tr.ts + dil seçimi veya varsayılan TR → Türkiye puanını belirgin artırır.  
3. **Audit log:** Kritik işlemlerin loglanması → uyumluluk ve operasyonel olgunluk.  
4. **Ingest partition (PR9):** Ölçek eşiğinde → Global puanı artırır.

---

## 5) Sonuç

- **Global SaaS puanı: 62/100** — Çok kiracılı, faturalandırılabilir ve güvenli bir SaaS; privacy/uyumluluk ve ölçek tamamlandıkça 75+ hedeflenebilir.  
- **Türkiye SaaS puanı: 59/100** — TRY/TRT ve pazar uyumu iyi; KVKK ve Türkçe arayüz tamamlandıkça 70+ hedeflenebilir.

Rapor, mevcut dokümantasyon ve kod taramasına dayanmaktadır; canlı ortam veya müşteri anketi kapsam dışıdır.
