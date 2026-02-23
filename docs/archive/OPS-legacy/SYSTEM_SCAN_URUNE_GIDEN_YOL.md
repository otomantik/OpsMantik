# OpsMantik — Sistem Taraması: Ürüne Giden Yol

**Tarih:** Şubat 2026  
**Amaç:** Tüm sistemi tarayıp genel puan, kalan işler ve ürüne giden yolun özeti.

---

## 1. Genel Puan (Özet)

| Boyut | Puan (0–100) | Not |
|-------|----------------|-----|
| **Motor / Doğruluk** | **92** | Sync, call-event, OCI runner, ledger, circuit breaker, semaphore çalışıyor; 212 test geçiyor. |
| **Özellik bütünlüğü** | **78** | Tracking → attribution → lead → call → conversation → sales → queue → worker tam; joinchat/WhatsApp grubu eklendi. |
| **Bakım kolaylığı** | **78** | PR-C4 tek runner; PR-C1 ile type leak büyük ölçüde giderildi; büyük route’lar kaldı. |
| **Tip güvenliği** | **100** | PR-C1 + son sıfırlama: app/lib/components’ta any 0; cookie options, IngestMeta, Window.jumpToSession tiplendi; no-explicit-any warn açık. |
| **Test sağlamlığı** | **72** | Unit testler geçiyor; test TS hataları giderildi (Faz 5); source-based testler hâlâ kırılgan (PR-C6). |
| **Prod hazırlık** | **82** | Worker/cron deploy edildi, smoke geçti; PR9/PR10 migration’ların prod’da uygulanması netleştirilmeli. |
| **Operasyon** | **75** | Runbook’lar, Watchtower, cron auth; formal SLO/alerting kısıtlı. |

**Genel ürün puanı (ağırlıklı):** **~80/100** — Ürüne giden yol açık; motor sağlam, tip güvenliği PR-C1 ile belirgin iyileşti.

---

## 2. Tamamlanan / Güçlü Taraflar

- **Tracking & ingest:** core.js (wa.me, whatsapp.com, joinchat, chat.whatsapp.com, data-om-whatsapp), sync pipeline (rate limit, idempotency, quota, QStash/fallback).
- **Call-event & intent:** Telefon/WhatsApp eşlemesi, ensure_session_intent_v1, lead skor, GCLID/wbraid/gbraid.
- **Conversation & sales:** Conversation link, sales CRUD, confirm, offline_conversion_queue enqueue.
- **OCI pipeline:** Tek runner (PR-C4), semaphore (PR11), ledger (provider_upload_attempts), circuit breaker (PR5), claim FOR UPDATE SKIP LOCKED.
- **Dashboard:** Site listesi, session/event/call, activity, attribution, KPI (phone/whatsapp intents).
- **Billing:** ingest_idempotency otoritesi, reconciliation, invoice freeze, dispute export.
- **Güvenlik:** RLS, CORS, cron auth (CRON_SECRET), tenant scope, vault credentials.
- **Docs:** OPS runbook’lar (PROVIDERS_UPLOAD_RUNBOOK, PR-C4, merge checklist), CODE_QUALITY_AUDIT, OCI durum, ürün/pazar raporu.

---

## 3. Kalan İşler (Ürüne Giden Yol)

### 3.1 Kritik (ürün çalışırlığı)

| Öğe | Durum | Aksiyon |
|-----|--------|---------|
| **PR9/PR10 migration’lar** | Dosyalar repo’da untracked; prod’da uygulandı mı net değil | Migration’ları commit et; prod DB’de `provider_upload_attempts` ve upload proof alanları varsa dokümante et. |
| **Prod smoke doğrulama** | Local smoke geçti | Prod’da worker + cron tetikle, log’da `run_complete` gör; gerekirse “processed>0” kanıtı al. |

### 3.2 Yüksek (kalite / bakım)

| Öğe | Durum | Aksiyon |
|-----|--------|---------|
| **Backend type leak (PR-C1)** | ✅ Tamamlandı (100) | app/lib/components’ta any 0; auth/server cookie options, test-page IngestMeta, utils Window.jumpToSession tiplendi. |
| **Büyük route’lar** | call-event, sync hâlâ büyük | PR-C4 benzeri parçalama (validation, scoring, persist ayrı modüller). |
| **Lint uyarıları** | 37 warning (unused vars vb.) | Temizle veya justify; 0 error koru. |

### 3.3 Orta (sağlamlık / uyumluluk)

| Öğe | Durum | Aksiyon |
|-----|--------|---------|
| **Source-based testler (PR-C6)** | readFileSync + includes | Runner/handler testleri; migration source check’ler gerekirse kalsın. |
| **Consent / KVKK** | Ürün raporunda “Yok” | İhtiyaç varsa consent banner, right-to-erasure, DPA dokümanı. |
| **WAR ROOM dashboard (OCI)** | OCI durum raporunda “Yapılmadı” | OCI kuyruk/ledger görünürlüğü için opsiyonel UI. |
| **SLO / alerting** | Watchtower var, formal SLO yok | SLO tanımı + basit alerting (opsiyonel). |

### 3.4 Düşük / Opsiyonel

| Öğe | Durum | Aksiyon |
|-----|--------|---------|
| **ux-core.js** | Eski embed core.js’e yönlendiriyor | Zaten /assets/core.js kullanılıyorsa mevcut hali yeterli. |
| **PR12 (token bucket)** | Planlandı | Runner’a local rate limit eklenebilir. |
| **Swallow catch (script’ler)** | Smoke script’lerde boş catch | En azından log ekle. |

---

## 4. Commit Edilmemiş / Takip Edilmesi Gerekenler

- **Modified (deploy’a alınmadı):** PROVIDERS_UPLOAD_RUNBOOK, adapter/auth/mapper/types (Google Ads), package.json, google-ads-adapter test.
- **Untracked:** app/api/test-oci, CODE_QUALITY_AUDIT, OCI_DURUM_RAPORU, OPSMANTIK_URUN_PAZAR_RAPORU, seed/trigger script’leri, **PR9/PR10 migration SQL’leri**.

İstersen: PR9/PR10 migration’ları + runbook + gerekli script’leri tek commit’te toplayıp “OCI prod-ready: migrations + runbook” diye push edebilirsin.

---

## 5. Ürüne Giden Yol (Sıralı Özet)

1. **Prod kanıtı** — Worker + cron prod’da çalıştığını log + (opsiyonel) processed>0 ile doğrula.
2. **Migration netliği** — PR9/PR10’u prod’da uyguladıysan commit + dokümante et; uygulamadıysan uygula.
3. ~~**Type leak (PR-C1)**~~ — Tamamlandı (Faz 1–5); kalan birkaç any opsiyonel.
4. **Cleanup** — Lint fix, gerekirse PR-C6 (test davranış testleri).
5. **İsteğe bağlı** — WAR ROOM OCI UI, consent/KVKK, SLO/alerting.

**Sonuç:** Motor hazır, ürün puanı ~76; kalan işler çoğunlukla kalite ve opsiyonel özellik. Ürüne giden yol net.
