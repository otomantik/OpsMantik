# OCI / Intent Pipeline — Deterministik Adli Analiz

**Tarih:** 3 Mart 2026  
**Amaç:** Intent card → Seal → OCI → Google Ads akışının tam anatomisi; mantıksal hatalar, delikler ve düzeltme önerileri.

---

## 1. Akış Haritası (End-to-End)

```
[Intent Card UI] → [Seal Modal] → [Seal API] → [apply_call_action_v1]
                                              → [enqueueSealConversion] (leadScore=100, sale_amount>0)
                                              → [evaluateAndRouteSignal] (V3/V4: leadScore 60/80)

[Call Event] → [process-call-event] → [evaluateAndRouteSignal V2_PULSE]
            → [calc-brain-score worker]

[offline_conversion_queue] ← [enqueueSealConversion]
            ↓
[claim_offline_conversion_jobs_v2] (cron/worker)
            ↓
[runner.ts] → [Google Ads API uploadClickConversions]
            ↓
[Google Ads]
```

---

## 2. Kritik Delikler (Bulunan Hatalar)

### 2.1 0 TL Seal — UI ve API

| Konum | Kod | Sorun |
|-------|-----|-------|
| `seal-modal.tsx` L62-64 | `effectiveAmount = customNum >= 0 ? customNum : null` | **0 TL geçerli.** `priceValid` 0'ı kabul ediyor. |
| `seal/route.ts` L43-48 | `saleAmount < 0` reddediyor, `saleAmount === 0` kabul ediyor | API 0 TL'yi kabul ediyor. |
| `calls` tablosu | `sale_amount = 0` yazılıyor | DB'de 0 TL kaydediliyor. |
| `enqueue-seal-conversion` L143-154 | `computeConversionValue` sale_amount≤0 → null | **Kuyruğa alınmıyor.** ✅ Bu katmanda 0 TL engelleniyor. |

**Sonuç:** 0 TL seal **UI ve API'de izin veriliyor**; call kaydı 0 TL ile güncelleniyor; **enqueue aşamasında** `no_sale_amount` ile atlanıyor. Yani Google'a 0 TL gitmiyor ✅, ancak operatör 0 TL girip "Mühür" basabiliyor; bu UX ve veri kalitesi açısından istenmiyor.

**Öneri:** Seal modal'da `effectiveAmount === 0` durumunda `canSave = false` veya uyarı göster; API'de `saleAmount === 0 && leadScore === 100` ise 400 dön.

---

### 2.2 GCLID vs wbraid/gbraid — Google'a Gönderilen Değer

| Konum | Açıklama |
|-------|----------|
| `get_call_session_for_oci` | Session'dan `gclid`, `wbraid`, `gbraid` döner. |
| `primary-source.ts` | Bu üç alanı olduğu gibi aktarır. |
| `enqueue-seal-conversion` L118-125 | En az biri dolu olmalı; hangisi doluysa o kullanılıyor. |
| `google-ads-export` L419-420 | `gclid`, `wbraid`, `gbraid` ayrı ayrı trim edilip payload'a ekleniyor. |
| `mapper.ts` L69-71 | `gclid` varsa onu, yoksa `wbraid`, yoksa `gbraid` gönderiyor. Öncelik: gclid > wbraid > gbraid. |

**Potansiyel sorun:** "GCLID değil başka değer gidiyor" — Eğer session'da **sadece gbraid** varsa (GCLID yok), Google'a **gbraid** gidiyor. Google Ads hesabı/setup gbraid'i kabul etmiyorsa "İçe aktarılan GCLID'nin kodu çözülemedi" benzeri hata alınabilir. Bu durumda sorun GCLID formatı değil, **gbraid/wbraid** ile conversion action uyumsuzluğu olabilir.

---

### 2.3 Nabızlar (V2_PULSE, V3, V4) — Neden Gitmeyebilir?

| Gear | Tetikleyici | Dosya | Koşullar |
|------|-------------|-------|----------|
| **V2_PULSE** | Call oluşturuldu | `process-call-event.ts` L234 | `evaluateAndRouteSignal('V2_PULSE')` — best-effort, hata yutulur. |
| **V3_ENGAGE** | Seal, lead_score=60 | `seal/route.ts` L206 | `leadScore === 60` → `evaluateAndRouteSignal('V3_ENGAGE')` |
| **V4_INTENT** | Seal, lead_score=80 | `seal/route.ts` L207 | `leadScore === 80` → `evaluateAndRouteSignal('V4_INTENT')` |
| **V5_SEAL** | Seal, lead_score=100 + enqueue | `seal/route.ts` L248 | `enqueueSealConversion` → queue → Google |

**V2_PULSE eksik olma nedenleri:**
1. `process-call-event` hata alıyor (L244-246: catch, console.error, devam).
2. `hasRecentV2Pulse` dedup: Aynı call_id veya gclid için son 24 saatte zaten V2 varsa atlanıyor (orchestrator L40-87).
3. `getPrimarySource` null dönüyor — session'da gclid/wbraid/gbraid yok.

**V3/V4 eksik olma nedenleri:**
1. Seal 60/80 ile yapılmıyor (örn. direkt 100).
2. `evaluateAndRouteSignal` hata veriyor (L237: catch, logError, seal devam).
3. `marketing_signals` unique (site_id, call_id, google_conversion_name) — duplicate insert 23505; orchestrator `routed: true` dönebilir (idempotent).

---

### 2.4 İlk Intent (V2) Yok — Olası Sebepler

- **Call event hiç işlenmedi:** Sync/ingest pipeline çalışmıyor veya hata veriyor.
- **Session'da GCLID yok:** Kullanıcı GPC/ITP/VPN ile geldi; gclid capture edilemedi.
- **V2 dedup:** Aynı call veya gclid için 24h içinde zaten V2 varsa tekrar emit edilmiyor.

---

### 2.5 value_cents 0 / NaN — Savunma Katmanları

| Katman | Dosya | Mantık |
|--------|-------|--------|
| 1. Enqueue | `enqueue-seal-conversion` L143-154 | `computeConversionValue` null → enqueue yok. |
| 2. OCI config | `oci-config.ts` L102-109 | `saleAmount <= 0` → null. |
| 3. Runner | `runner.ts` | `value_cents` null/undefined/≤0 satırları filtreler (L426-439, L662-675). |
| 4. Google export | `google-ads-export` L388-402 | `!Number.isFinite(valueCents) || valueCents <= 0` → skip, FAILED. |
| 5. Mapper | `mapper.ts` L57 | `payload.value_cents` veya `job.amount_cents` — 0 geçerse `minorToMajor(0)` = 0 TL gider. |

**Tehlike:** Runner veya export'ta `Number(x) || 0` gibi bir fallback varsa 0 TL Google'a gidebilir.  
**Kontrol:** `tests/unit/oci-value-zero-export-guard.test.ts` bu pattern'i reddediyor. Export'ta L393-402 ile 0 skip ediliyor ✅.

---

### 2.6 GCLID Format — Base64URL vs Base64

| Konum | Açıklama |
|-------|----------|
| `mapper.ts` L27-29 | `normalizeClickIdForGoogle`: `-` → `+`, `_` → `/` (base64url → base64). |
| `oci-fix-gclid-decode.mjs` | Script: base64url'ü standart base64'e çevirip queue'yu güncelliyor. |

"İçe aktarılan GCLID'nin kodu çözülemedi" — Genellikle base64url formatındaki GCLID'nin standart base64'e çevrilmeden gönderilmesinden kaynaklanır. `normalizeClickIdForGoogle` bu dönüşümü yapıyor; ancak **queue'da zaten yanlış formatta saklanmış** GCLID varsa script ile toplu düzeltme gerekebilir.

---

## 3. Bağımlılık Zinciri (Intent Card → Google)

```
Intent Card (HunterIntent)
  └─ intent_target (tıklanan numara)
  └─ openSealModal(intent)

Seal Modal
  └─ sale_amount (customAmount) — 0 kabul ediliyor ⚠️
  └─ caller_phone (opsiyonel)
  └─ onConfirm(saleAmount, currency, 100, callerPhone)

use-queue-controller
  └─ onSealConfirm → POST /api/calls/:id/seal
  └─ body: { sale_amount, currency, lead_score, caller_phone? }

Seal API
  └─ sale_amount validation: < 0 red, 0 kabul ⚠️
  └─ apply_call_action_v1 (DB update)
  └─ leadScore=60|80 → evaluateAndRouteSignal (V3/V4)
  └─ leadScore=100 → enqueueSealConversion

enqueueSealConversion
  └─ getPrimarySource(siteId, { callId }) → gclid, wbraid, gbraid
  └─ hasMarketingConsentForCall
  └─ computeConversionValue(star, saleAmount) — 0 → null, enqueue yok ✅
  └─ insert offline_conversion_queue

getPrimarySource
  └─ get_call_session_for_oci(call_id, site_id) RPC
  └─ calls JOIN sessions ON matched_session_id
  └─ sessions.gclid, wbraid, gbraid

Cron/Worker
  └─ claim_offline_conversion_jobs_v2
  └─ runner.ts: value_cents ≤ 0 satırları elenir
  └─ adapter.uploadConversions (Google Ads API)

Google Ads Export (script modu)
  └─ value_cents ≤ 0 / NaN → skip, FAILED
  └─ gclid/wbraid/gbraid → mapper → normalizeClickIdForGoogle
```

---

## 4. Düzeltme Önerileri (Öncelik Sırası)

| # | Sorun | Çözüm | Dosya |
|---|-------|-------|-------|
| 1 | 0 TL seal UI'da mümkün | `canSave = false` when `effectiveAmount === 0`; veya "0 TL ile mühür basılamaz" uyarısı | seal-modal.tsx |
| 2 | 0 TL seal API'de kabul | `saleAmount === 0 && leadScore === 100` → 400 "0 TL ile mühür basılamaz" | seal/route.ts |
| 3 | Nabızlar sessiz hata | V2/V3/V4 emit hatalarında Sentry/alert; retry mekanizması değerlendir | process-call-event, seal/route |
| 4 | gbraid-only reddi | Google Ads conversion action'ın gbraid/wbraid destekleyip desteklemediğini doğrula; desteklemiyorsa net hata mesajı | Dokümantasyon / runbook |
| 5 | Version frontend | HunterIntent'e version eklenebilir (get_intent_details RPC'den); optimistic locking için body.version gönder | lib/types/hunter, RPC |

---

## 5. Test Kontrol Listesi

- [ ] Seal modal: 0 TL girildiğinde "Kaydet" disabled veya uyarı.
- [ ] Seal API: `sale_amount: 0, lead_score: 100` → 400.
- [ ] Enqueue: `sale_amount: 0` → `reason: 'no_sale_amount'`, queue'ya insert yok.
- [ ] Export: `value_cents: 0` satırı skip, FAILED.
- [ ] V2_PULSE: Call oluşunca marketing_signals'ta INTENT_CAPTURED var mı?
- [ ] V3/V4: Seal 60/80 ile marketing_signals'a V3_ENGAGE / V4_INTENT yazılıyor mu?
- [ ] GCLID: Base64URL → Base64 dönüşümü mapper'da uygulanıyor mu?

---

## 6. İlgili Dosyalar

| Akış | Dosya |
|------|-------|
| Seal UI | components/dashboard/seal-modal.tsx, lib/hooks/use-queue-controller.ts |
| Seal API | app/api/calls/[id]/seal/route.ts |
| Enqueue | lib/oci/enqueue-seal-conversion.ts |
| Value logic | lib/oci/oci-config.ts |
| Primary source | lib/conversation/primary-source.ts |
| Runner | lib/oci/runner.ts |
| Export | app/api/oci/google-ads-export/route.ts |
| Mapper | lib/providers/google_ads/mapper.ts |
| Orchestrator | lib/domain/mizan-mantik/orchestrator.ts |
| Call ingest | lib/ingest/process-call-event.ts |
| RPC | get_call_session_for_oci (supabase/migrations) |

---

## 7. Tam Mantık Hataları ve Olası Durumlar (Deterministik Tarama)

### 7.1 Dead Code / Ulaşılamayan Kod

| Dosya | Satır | Açıklama |
|-------|-------|----------|
| `oci-config.ts` | L110-116 | `computeConversionValue` içinde `star` ve `weights` ile hesaplama bloğu **hiç çalışmıyor**. `saleAmount > 0` → return; `saleAmount ≤ 0 || null` → return null. Arada star-based valuation yok. Product kararı: "no sale = no enqueue" doğru; ancak kod temizlenmeli veya "qualified no-sale estimated value" senaryosu netleştirilmeli. |

### 7.2 Sessiz Hata / Best-Effort Yutma

| Dosya | Senaryo | Risk |
|-------|---------|------|
| `process-call-event.ts` L244 | V2_PULSE emit hata → `console.error` sonra devam | V2 hiç yazılmaz; operatör fark etmez. Sentry/alert yok. |
| `seal/route.ts` L244 | V3/V4 emit hata → `logError` sonra seal devam | Nabız gitmez; seal başarılı görünür. |
| `seal/route.ts` L269 | enqueueSealConversion hata → `logError` sonra seal devam | Google'a conversion gitmez; DB'de sealed kalır. |
| `primary-source.ts` | RPC/query hata → `catch` → return null | GCLID bulunamaz; enqueue skip. Sessiz. |
| `orchestrator.ts` L217 | append_causal_dna_ledger hata → `console.error` | Best-effort; ledger eksik kalabilir. |
| `enqueue-seal-conversion.ts` L227-234 | append_causal_dna_ledger → fire-and-forget | Ledger eksik kalırsa sessiz. |

### 7.3 Race / Timing Edge Case

| Senaryo | Açıklama |
|---------|----------|
| V2 getPrimarySource | Call az önce insert edildi; `get_call_session_for_oci` aynı transaction dışında. Session + call row okuma arasında replica lag varsa null dönebilir. |
| duplicate_session dedup | Enqueue öncesi `session_id` ile QUEUED/RETRY/PROCESSING kontrolü; iki paralel seal aynı session için farklı call'larla tetiklenirse TOCTOU. |
| claim_offline_conversion_jobs_v2 | FOR UPDATE SKIP LOCKED ile korunuyor; tek writer var. |

### 7.4 Null / Undefined Edge Case

| Konum | Senaryo | Sonuç |
|-------|---------|-------|
| `mapper.ts` L57 | `payload.value_cents` ve `job.amount_cents` ikisi undefined | `valueCents = undefined` → `minorToMajor(undefined, currency)` = NaN. Runner bu satırları filtre etmeden adapter'a verirse NaN Google'a gider. |
| `primary-source.ts` | `rows[0]` null / undefined | `row.gclid ?? null` safe; ama `rows` boş array ise `rows[0]` undefined, tip cast ile devam. |
| `enqueue-seal-conversion` L139 | `leadScore` null → `leadScoreToStar(null)` = null | `star` null → `computeConversionValue(null, saleAmount, config)`. saleAmount > 0 ise return saleAmount; star hiç kullanılmaz. OK. |
| `orchestrator` V2 | `gclid` null, `callId` var | `hasRecentV2Pulse(siteId, callId, null)` — sadece call_id ile dedup. GCLID yoksa bile V2 emit edilebilir; export'ta click ID olmadığı için skip. |
| `get_call_session_for_oci` | `c.session_created_month` NULL (trigger öncesi eski kayıt) | `s.created_month = c.session_created_month` → NULL = NULL → false. Session JOIN eşleşmez; gclid null. Eski call'larda mümkün. |

### 7.5 Değer / Tipler

| Konum | Senaryo | Sonuç |
|-------|---------|-------|
| `leadScoreToStar` | leadScore 100 → star 5; 60 → 3; 0 → null | 0-20 arası → star 1; 81-100 → star 5. |
| `time-decay` | V2, clickDate = signalDate (0 gün) | `calculateDecayDays` ceil → 0 gün. `getDecayProfileForGear(V2, 0)` = 0.5. |
| `value-config` | Site bulunamaz → `GLOBAL_FALLBACK_AOV` 1000 | defaultAov 1000 TRY kullanılır. |
| `google-ads-export` signalItems | `conversion_value` null/undefined | `Number(rowValue) \|\| 0` → **0 TL gönderir**. V2/V3/V4 için beklenen değer 0 olabilir (pending 0.02 ratio, aov 0); ama defaultAov varsa 0 olmamalı. |
| `runner` syncQueueValuesFromCalls | `row.value_cents` string (DB'den) | `Number(row.value_cents)` ile parse; NaN ise karşılaştırma hatalı. `typeof row.value_cents === 'number'` kontrolü var. |

### 7.6 Session / Partition Uyumsuzluğu

| Senaryo | Açıklama |
|---------|----------|
| `s.created_month = c.session_created_month` | RPC JOIN koşulu. Trigger (`trg_calls_enforce_session_created_month`) yeni insert'lerde `session_created_month` set ediyor. Eski kayıtlarda NULL olabilir; backfill sonrası da NULL kalanlar JOIN'de eşleşmez. |
| process-call-event `sessionMonth` | `matched_session_month ?? (matched_at'ten türet)`. Session'ın `created_month`'u ile uyuşmazsa RPC'de eşleşme olmaz. Trigger insert sırasında `matched_at` kullanıyor; payload'taki sessionMonth ile çakışabilir. |
| GCLID session backfill | `process-call-event` L86-114: Session'da gclid yok, payload'ta varsa UPDATE yapıyor. `created_month` filtreli; session row yanlış partition'dan okunursa update 0 row etkiler. |

### 7.7 V2 Dedup Aşırı Agresif

| Senaryo | Açıklama |
|---------|----------|
| Aynı gclid, 2 farklı call, 24h içinde | `hasRecentV2Pulse` gclid ile sessions → calls → signals bakar. İlk call V2 aldıysa, ikinci call'da V2 atlanır. Doğru: aynı tıklamadan iki conversion istemiyoruz. |
| Aynı gclid, tek session, birden fazla intent | Her intent = yeni call. İlk call V2; diğerleri dedup. "İlk temas" sadece ilk call'a gidiyor. Bu beklenen. |

### 7.8 Intent Card → Seal Modal Bağlantısı

| Akış | Not |
|------|-----|
| Intent Card "Mühür" | `openSealModal(intent)` → Seal Modal açılır. Modal **her zaman** lead_score 100 gönderir. |
| Intent Card "Görüşüldü" (60) / "Teklif" (80) | Farklı flow: `qualifyModalIntent` veya benzeri. Seal API'ye `lead_score: 60/80` gidebilir; sale_amount opsiyonel. Bu durumda 0 TL kabul edilir (sadece lead 100'de reddediyoruz). |
| Version | `seal/route` body.version → optimistic lock. Frontend `get_intent_details_v1`'dan `call.version` alıp göndermiyor olabilir; RPC'de `p_version: version ?? call.version` ile DB'deki kullanılıyor. |

### 7.9 Export Pipeline B — marketing_signals

| Senaryo | Açıklama |
|---------|----------|
| `getPrimarySourceBatch` | Call → session → gclid. Call'da `matched_session_id` yoksa veya session gclid'sizse source null; export `if (!clickId) continue` ile satırı atlar. |
| Signal PENDING kalır | Click ID yoksa export skip; signal PENDING'de kalır. Tekrar deneme yok; manuel veya batch fix gerekebilir. |
| conversion_value 0 | `Number(rowValue) \|\| 0` — null/undefined/0 → 0 TL. Google'a 0 değer gidebilir. V1 (pageview) kasıtlı 0; V2/V3/V4 için site defaultAov varsa 0 olmamalı. |

### 7.10 Olası Senaryolar Özeti

| # | Senaryo | Sonuç |
|---|---------|-------|
| 1 | Operatör 0 TL girer, Mühür basar | ~~UI/API kabul ediyordu~~ → Artık UI engelliyor, API 400. |
| 2 | Session'da gclid yok, wbraid var | gbraid/wbraid gider; Google kabul etmezse hata. |
| 3 | Call oluşur, V2 emit hata verir | Sessiz; marketing_signals'a yazılmaz. |
| 4 | Seal 100, enqueue hata | Call sealed; queue'ya girmez. Sessiz. |
| 5 | V2 emit OK, export'ta click ID yok | Signal PENDING kalır; Google'a gitmez. |
| 6 | `session_created_month` NULL (eski call) | get_call_session_for_oci gclid dönmez; enqueue skip. |
| 7 | İki call aynı session, 24h içinde | İkinci call V2 dedup; sadece ilk call V2 alır. |
| 8 | default_aov 0, intentWeights normal | V2 base = 0 * 0.02 = 0; decay sonrası 0. 0 TL nabız gider. |
