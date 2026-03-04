# Google Ads OCI — Olası Sorunlar Kontrol Listesi

**Tarih:** 2026-03-04  
**Kapsam:** Worker (Node) + Google Ads adapter/mapper + kuyruk akışı. Değişiklik yapılmadı; sadece olası sorunlar listeleniyor.

---

## 1. Site `oci_sync_method` — Worker (api) vs Script

**Ne:** `list_offline_conversion_groups` ve `claim_offline_conversion_jobs_v2` yalnızca **`sites.oci_sync_method = 'api'`** olan siteleri döner / claim eder.

- Varsayılan değer: **`script`**. Migration’da, `provider_credentials` (google_ads, active) olan siteler **`api`** yapılmış.
- Eğer Muratcan (veya başka bir site) bir şekilde **`script`** kalmışsa, **worker bu sitenin kuyruk satırlarını hiç claim etmez**; kuyruk dolsa bile gönderim yapılmaz.

**Phase 2 (DB config):** Muratcan’ı worker’a açmak için migration eklendi:  
`supabase/migrations/20260708000000_sites_oci_sync_method_script.sql` — `oci_sync_method = 'api'` olan tüm siteleri `script` yapar. API yok, tüm siteler script export ile çalışır.

**Kontrol (RECON):**  
`SELECT id, name, oci_sync_method FROM sites WHERE id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';`  
Tüm siteler script ise `oci_sync_method = 'script'` olmalı.

---

## 2. ~~Poison pill sonrası hashed_phone hizası (runner)~~ — GİDERİLDİ

**Ne:** Poison pill izolasyonundan sonra `jobs` dizisi, poison olan satırlar **çıkarılmış** haliyle oluşuyor; `rowsWithValue` ise aynı kalıyor. Ama hashed_phone zenginleştirmesinde `jobs[i]` ile **`rowsWithValue[i]`** eşleştiriliyor.

- Örnek: 8 satır, 3. indeks poison.  
  `jobs = [r0, r1, r2, r4, r5, r6, r7]`, `rowsWithValue = [r0..r7]`.  
  `i=3` için `row = rowsWithValue[3]` = r3 (poison), `jobs[3]` ise r4’ün job’u. Yani r4’ün job’una **r3’ün call’ından** (yanlış call) hashed_phone yazılma riski var.

**Etki:** Poison satır olduğunda, bazı dönüşümlere **yanlış call’ın** telefon hash’i gidebilir (Enhanced Conversions’da yanlış eşleşme).

**Nerede:** `lib/oci/runner.ts` — worker path (~satır 643–649) ve cron path (~996–1002):  
`const row = rowsWithValue[i];` kullanımı; `jobs` ile `rowsWithValue` indeksleri poison sonrası aynı değil.

**Yapılan (2026-03-04):** ID tabanlı Map: `rowIdToRow = new Map(rowsWithValue.map(r => [r.id, r]))`, döngüde `row = rowIdToRow.get(jobs[i].id)` ve `if (!row) continue;` ile eşleştirme. Cross-contamination kaldırıldı.

**Öneri (uygulandı):** Call’ı job id üzerinden eşleştirin: `const row = rowsWithValue.find(r => r.id === jobs[i].id)` veya önceden `rowIdToRow` Map’i doldurup `rowIdToRow.get(jobs[i].id)`.

---

## 3. Google Ads Script vs Worker — Çift gönderim değil, ama tek kanal

**Ne:** İki kanal var:

- **API (worker):** `POST /api/workers/google-ads-oci` → claim → Google’a REST ile yükleme. Sadece **`oci_sync_method = 'api'`** siteleri işlenir.
- **Script:** `scripts/google-ads-oci/GoogleAdsScript.js` (Apps Script) → `/api/oci/google-ads-export` ile dönüşümleri çeker → Google tarafında yükler → ack.

Aynı site için hem `api` hem script’i aynı anda kullanırsanız, sync_method’a göre sadece biri kuyruğu “görür”; yine de **tek site için tek kanal (ya api ya script)** kullanılması daha net olur. Muratcan worker ile gidiyorsa, bu site için Script’in aynı kuyruğu çekmemesi (veya Script’in bu site’ta çalışmaması) iyi olur.

**Kontrol:** Muratcan için ya sadece worker (api) ya da sadece Google Ads Script kullanıldığından emin olun; iki kanalın aynı site’ı aynı anda işlemediğini doğrulayın.

---

## 4. conversion_date_time formatı (Google API)

**Ne:** Mapper `toConversionDateTime` ile **`yyyy-mm-dd hh:mm:ss+00:00`** (colon’lu timezone) üretiyor. Google Ads API’nin beklediği format zaman zaman dokümante ediliyor; ileride **colon’suz** (`+0000`) zorunlu olursa doğrulama hatası alınabilir.

**Şu an:** Bilinen bir uyumsuzluk yok; sadece API dokümanı değişirse kontrol edilmesi gereken nokta.

---

## 5. partial_failure indeks eşlemesi (adapter)

**Ne:** Adapter, Google’dan dönen `partial_failure_error.details[].errors[].location.field_path_elements[0].index` ile hatayı **batch içindeki indekse** göre job’a yazıyor. Google’ın sonucu her zaman gönderim sırasıyla döndüğü varsayılıyor.

**Risk:** API davranışı değişir ve sonuç sırası gönderim sırasıyla aynı kalmazsa, hata yanlış queue satırına yazılabilir. Şu an için yaygın kullanım sıra korunduğu yönünde.

---

## 6. value_cents ≤ 0 ve credentials

**Ne:**  
- `value_cents` null veya ≤ 0 olan satırlar worker’da **atlanıyor** ve **FAILED (VALUE_ZERO)** işaretleniyor; bu beklenen davranış.  
- Credentials yoksa veya decrypt hata verirse tüm gruptaki satırlar **FAILED** oluyor; tekrar denemede yine aynı sonuç alınır.

**Kontrol:** Muratcan için `provider_credentials` (google_ads, is_active, encrypted_payload) dolu ve decrypt’in başarılı olduğundan emin olun.

---

## 7. Özet tablo

| # | Konu | Olası etki | Öncelik |
|---|------|------------|---------|
| 1 | Muratcan `oci_sync_method` ≠ `api` | Worker kuyruğu hiç işlemez → Phase 2 migration eklendi | Yüksek |
| 2 | Poison pill sonrası hashed_phone indeksi | ~~Giderildi (ID Map)~~ | — |
| 3 | Script vs Worker aynı site | Phase 3 taktik (aşağıda) | Düşük |
| 4 | conversion_date_time format | İleride API değişirse hata | Düşük |
| 5 | partial_failure index | Nadiren yanlış satıra hata yazılması | Düşük |
| 6 | Credentials / value_cents | Zaten ele alınıyor | Bilgi |

---

## Phase 3 / Target #3 — Apps Script dual-channel önleme (taktik not)

**Amaç:** Muratcan artık **api** ile worker’dan işlendiği için, aynı site’ın Google Ads Script tarafından da çekilmesini kapatmak (dual-channel çakışması / çift gönderim riski yok; ama tek kanal net olsun).

**Seçenekler:**

1. **Sunset:** Muratcan’ın Script Properties’inde `OPSMANTIK_SITE_ID` listesinden Muratcan site id’sini çıkarın; script sadece diğer (script sync’li) siteleri çeker.
2. **Quarantine:** Script’te site bazlı guard: `oci_sync_method === 'api'` olan siteleri export/ack listesine ekleme (script şu an DB’e erişmez; bu guard için script’in site listesini API’den alması veya Script Properties’te api/script ayrımı gerekir). En basit yol: Properties’te Muratcan’ı kaldırmak (yukarıdaki Sunset).
3. **Doc-only:** Runbook’ta “Muratcan = api; Script’te bu site çalıştırılmamalı” notu (zaten list_offline_conversion_groups sadece api siteleri döndüğü için script farklı bir endpoint kullanıyorsa çakışma olmayabilir; script `/api/oci/google-ads-export?siteId=…` ile site bazlı çekiyorsa, Muratcan’ı script tetikleyicisinden çıkarmak yeterli).

**Öneri:** Script’in hangi site_id’lerle tetiklendiğini kontrol edin (Properties veya deploy config). Muratcan (`c644fff7-9d7a-440d-b9bf-99f3a0f86073`) orada varsa kaldırın; böylece tek kanal = worker.

---

### SOP: Apps Script Quarantine (Sunset Maneuver)

**Objective:** Prevent legacy Google Apps Script from processing OCI queues for sites migrated to the new Worker (API) infrastructure. Zero code change; config-only.

**Execution steps:**

| Step | Action |
|------|--------|
| 1. **Infiltrate** | Log into the Google Cloud / Google Workspace account that hosts the legacy Apps Script (`GoogleAdsScript.js` or site-specific Quantum script). |
| 2. **Navigate** | Open the Apps Script Editor → click the **Project Settings** (gear icon) in the left sidebar. |
| 3. **Locate target** | Scroll to **Script Properties**. Find the key that holds active site IDs (e.g. `OPSMANTIK_SITE_ID`, `SITE_IDS`, `TARGET_SITES`, or equivalent). |
| 4. **Neutralize** | Edit the value and **remove** Muratcan’s site ID: `c644fff7-9d7a-440d-b9bf-99f3a0f86073`. Keep any other site IDs intact. |
| 5. **Secure** | Save the Script Properties. |
| 6. **Verify (RECON)** | On the next script run, check execution logs to confirm the script no longer processes the removed site and only processes remaining (script-sync) sites. |

**Outcome:** Legacy script skips Muratcan; Worker (API) remains the single channel for that site. No dual-channel sync.

---

**Sonuç:** Phase 2 migration ile Muratcan `oci_sync_method = 'api'` yapıldığında worker kuyruğu claim eder. Phase 3 SOP ile Script Properties’ten Muratcan site id kaldırılarak tek kanal netleştirilir.

---

## 8. GCLID "kodu çözülemedi" + Telefonla gönderim (Enhanced Conversions)

**Ne:** Google Ads yükleme sonrası "İçe aktarılan GCLID'nin kodu çözülemedi" hatası. Bazı tıklama kimlikleri (ör. `0AAAAA9/Qf/oX0U8e9DNFyMEzOkKBuKTKO`) Google tarafında decode edilemeyebilir (kaynak/farklı encoding).

**Yapılan:**
- Script CSV’de GCLID **base64url** gönderiliyor: `normalizeClickIdForCsv` ile `+` → `-`, `/` → `_`.
- **Telefon eşleştirme:** Export API dönüşüm satırına `hashed_phone_number` (SHA256, E.164) ekliyor; Script CSV’ye **"Phone"** kolonu ile bu değeri yazıyor. Google Ads hesabında **Gelişmiş dönüşümler (Enhanced Conversions for leads)** açıksa, GCLID decode hatası olsa bile **hashed phone** ile eşleşme yapılabilir.
- **Kontrol:** Google Ads → Araçlar → Yüklemeler’de hata detayı; hesap ayarlarında "Gelişmiş dönüşümler" / "Enhanced Conversions" açık olmalı.

**Nitelikli görüşmeler listelenmedi:** V3 (Nitelikli Görüşme) sinyalleri `marketing_signals` tablosundan gelir; export’a yalnızca **PENDING** ve uyumlu conversion_name olanlar eklenir. Listelenmeme sebepleri: zaten **SENT**, **click_id yok** (skip), veya export limiti. Kuyruk raporu: `oci-muratcan-kuyruk-rapor.mjs` / `oci-muratcan-kuyruk-donusum-tarama.mjs`.

---

## 9. Muratcan: Tüm gün + gitmemiş dönüşümleri kuyruğa al

**Amaç:** Muratcan için bugünkü mühürleri ve daha önce FAILED/RETRY kalan tüm dönüşümleri tekrar kuyruğa almak.

| Adım | Komut | Açıklama |
|------|--------|----------|
| 1 | `node scripts/db/oci-enqueue.mjs Muratcan --days 2` | Son 2 gün (dün + bugün) mühürleri kuyruğa ekler; zaten QUEUED olanlar skip-if-queued ile atlanır. |
| 2 | `node scripts/db/oci-requeue-all-failed.mjs` | Tüm sitelerdeki FAILED/RETRY satırları QUEUED yapar (Muratcan dahil). İsteğe: `--dry-run` ile önizleme. |

Sadece bugün: `node scripts/db/oci-enqueue.mjs Muratcan --today`
