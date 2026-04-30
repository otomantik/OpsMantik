# Google Ads OCI — Olası Sorunlar Kontrol Listesi

**Tarih:** 2026-03-04  
**Kapsam:** Worker (Node) + Google Ads adapter/mapper + kuyruk akışı. Değişiklik yapılmadı; sadece olası sorunlar listeleniyor.

---

## 0. Script 404 — "requested path is invalid"

**Belirti:** Quantum Engine logunda `[ERROR] API unreachable. Code: 404 | Response: {"error":"requested path is invalid"}`.

**Ne anlama gelir:** İstek **uygulama route’una ulaşmadan** 404 alıyor. Bu mesaj kod tabanında yok; büyük ihtimalle Vercel / önde bir proxy veya farklı bir host dönüyor.

**Kontrol listesi:**

1. **Doğru base URL:** Script’te `API_URL` (örn. `https://console.opsmantik.com`) canlıda gerçekten Next.js uygulamasının deploy edildiği adres mi? Farklı bir domain (örn. `api.opsmantik.com`) kullanılıyorsa orada bu path tanımlı mı?
2. **Path:** Export endpoint **`GET /api/oci/google-ads-export`**. Curl ile dene (x-api-key: deploy script'teki `CONFIG.X_API_KEY` — Eslamed: `scripts/google-ads-oci/deploy/Eslamed-OCI-Quantum.js`):
   ```bash
   # Windows PowerShell'de curl alias'ı farklı olduğu için curl.exe kullanın
   curl.exe -s -w "\n%{http_code}" "https://console.opsmantik.com/api/oci/google-ads-export?siteId=81d957f3c7534f53b12ff305f9f07ae7" -H "x-api-key: BURAYA_DEPLOY_SCRIPTTEKI_X_API_KEY"
   ```
  - 200 + JSON (`data`, `meta.hasNextPage`, `meta.nextCursor`) → API erişilebilir.
   - 401 → API key yanlış veya eksik; deploy script'teki `CONFIG.X_API_KEY` ile aynı değeri kullandığınızdan emin olun.
   - 404 → Path yanlış veya bu path o ortamda yok (deploy / rewrite kontrolü).
3. **Vercel deploy:** Son deploy’da `app/api/oci/google-ads-export/route.ts` var mı? Production branch güncel mi?
4. **Domain / proxy:** `console.opsmantik.com` farklı bir projeye veya static site’a işaret ediyorsa, API path’i o tarafta tanımlı olmayabilir; doğru API host’u script’te kullan.

**Özet:** 404 alıyorsan önce curl ile aynı URL’i dene; 200 geliyorsa script tarafında URL/header hatası, 404 geliyorsa host/path/deploy tarafını kontrol et.

**Eslamed “dün 22:40’tan beri ne birikti?” raporu:**  
`node scripts/db/oci-eslamed-dun-2240-biriken.mjs` — Kuyruk özeti (QUEUED/PROCESSING/UPLOADED), 22:40 sonrası mühürlenen call’lar, nabız PENDING sayısı.

**Eslamed tam aktivite (operatör + kuyruk + nabız):**  
`node scripts/db/oci-eslamed-aktivite-rapor.mjs` — Dün 22:00 TRT sonrası call_actions, mühürlenen call'lar, kuyruk, marketing_signals. PROCESSING takılı varsa manuel ack örnek curl çıktıda.

---

## 0b. PROCESSING'de takılı satır (Google'a gitti ama ack 404 aldı)

**Belirti:** Kuyrukta status=PROCESSING, dönüşüm Google Ads'e gitti ama satır UPLOADED'e geçmedi.

**Neden:** Script export → PROCESSING yapar; upload Google'a gider; sonra ack (`POST /api/oci/ack`) çağrılır. Ack 404/401 alırsa satır PROCESSING'de kalır.

**Yapılan:** Deploy script'lerde `sendAck` sonrası response kodu kontrol ediliyor; 200 değilse `[ERROR] Ack failed. Code: ...` loglanıyor.

**Çözüm A — Google'a gittiğinden eminsen:** `POST /api/oci/ack` ile `queueIds: ["seal_<queue_uuid>"]` gönder (x-api-key = CONFIG.X_API_KEY). Sadece PROCESSING satırları UPLOADED olur. Windows'ta JSON escape sorunu olursa: body'yi bir dosyaya yazıp `curl.exe -d "@ack-body.json"` kullan.

**Çözüm B — Tekrar gönderilsin:** Dashboard → OCI Control → PROCESSING satırı seç → Reset to Queued. Sonraki script çalışmasında tekrar gönderilir; ack 200 alırsa UPLOADED olur.

---

## 0c. V2 ilk temas hattı kaldırıldı

**Güncel durum:** Universal cutover sonrası ilk temas / `V2_PULSE` hattı aktif export ve runtime akışından çıkarıldı. Sync ve call-event artık V2 pulse üretmez; ana optimizasyon funnel'ı sadece `gorusuldu`, `teklif`, `satis` üstünden ilerler.

**Sonuç:** Google Ads script tarafında artık queue (`satis`) + canonical signal satırları (`gorusuldu` / `teklif`) beklenir. `INTENT_CAPTURED` / `V2_PULSE` artık operasyonel SSOT değildir.

---

## 0d. Nabız (V2/V3/V4) PROCESSING'de takılı — ack PENDING arıyordu (düzeltildi)

**Belirti:** `marketing_signals` satırları export'ta dönüyor, script Google'a yüklüyor, ack 200 alıyor ama satırlar hep `dispatch_status = PROCESSING` kalıyor; SENT'e geçmiyor.

**Neden:** Export, döndürdüğü sinyal satırlarını hemen **PROCESSING** yapıyor. Ack ise **PENDING** olanları SENT yapıyordu. Sonuç: Hiçbir nabız satırı ack'te güncellenmiyordu.

**Yapılan:** `app/api/oci/ack/route.ts` — Sinyal güncellemesi artık `dispatch_status = 'PROCESSING'` ile yapılıyor (SENT'e geçer). `app/api/oci/ack-failed/route.ts` — Sinyal FAILED güncellemesi `PENDING` veya `PROCESSING` olanlara uygulanıyor.

**Detailed flow:** [`docs/architecture/OCI_QUEUE_HEALTH.md`](../architecture/OCI_QUEUE_HEALTH.md) and [`docs/architecture/EXPORT_CONTRACT.md`](../architecture/EXPORT_CONTRACT.md) cover queue statuses, claim semantics, and export shape.

---

## 0e. Script–API uyumluluk (Eslamed / Muratcan deploy)

**Kontrol edilen:** Yapılan düzeltmelere (export `{ data, meta }`, ack PROCESSING/granular result, ack response kontrolü) deploy script’lerin uyumu.

| Kontrol | Eslamed-OCI-Quantum.js | Muratcan-OCI-Quantum.js |
|--------|------------------------|--------------------------|
| Export response | `exportData.items`, `exportData.next_cursor` kullanıyor | Aynı |
| Boş kontrol | `!exportData \|\| !exportData.items \|\| exportData.items.length === 0` | Aynı |
| Cursor döngü | `nextCursor = exportData.next_cursor`, cursor ile tekrar fetch | Aynı |
| CSV alanları | id, conversionName, conversionTime, conversionValue, conversionCurrency, gclid, wbraid, gbraid, hashed_phone_number (API ile aynı) | Aynı |
| Ack payload | `queueIds: successIds` (seal_*, signal_*, pv_* id’leri) | Aynı |
| Ack 200 kontrolü | Var; 200 değilse `[ERROR] Ack failed. Code: ...` | Aynı |
| ack-failed | fatalErrorIds → sendNack (queueIds: [], fatalErrorIds) | Aynı |

**Sonuç:** Eslamed ve Muratcan deploy script’leri (`scripts/google-ads-oci/deploy/*.js`) mevcut API ile uyumlu snapshot'lardır.

**Not:** Canonical kaynak artık `scripts/google-ads-oci/GoogleAdsScript.js` dosyasıdır ve `{ items, next_cursor }` cevabını doğru işler. Deploy snapshot'ları kaynak dosya değil, dağıtım kopyası olarak görülmelidir.

---

## 0f. Eslamed — 22:40 sonrası röntgen + saldırı ayıklama (temiz kuyruk)

**Ne:** Dün gece 22:40 (TRT) sonrası intent'lerin röntgeni; saldırı (şüpheli) vs temiz ayrımı; Google'a gönderilecek temiz kuyruk listesi.

**Kriterler (runbook ile uyumlu):** ≤3sn kalış, tek etkileşim, proxy, aynı fingerprint >3 intent, aynı IP >5 intent — bunlardan biri varsa **saldırı**.

**Çalıştır:** `npm run db:oci-2240-rontgen` veya `node scripts/db/oci-eslamed-2240-rontgen-saldiri-ayikla.mjs`. Seçenekler: `--full` (tüm satırlar), `--no-write` (JSON yazma).

**Çıktı:** Özet (saldırı/temiz sayısı), röntgen tablosu, temiz kuyruk ve saldırı call_id listesi. Yazılırsa: `tmp/oci-eslamed-2240-<stamp>-temiz-kuyruk.json`, `-saldiri-call-ids.json`, `-rontgen-full.json`.

**Sonraki adımlar:** Saldırı call'ları junk'lanır; temiz kuyruk export ile Google'a gider. Sistem istediğin gibi çalışıyorsa geçmiş temizliği yapılabilir.

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
