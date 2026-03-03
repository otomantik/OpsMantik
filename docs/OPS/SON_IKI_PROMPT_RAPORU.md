# Son İki Prompt — Yapılanlar Raporu ve Test Hazırlığı

Bu dokümanda son iki ana istekte yapılan geliştirmeler özetleniyor; değerlendirme ve test hazırlığı için kullanılabilir.

---

## 1. İlk Prompt: Deep-Attribution DIC Veri Mimarisi Planı (Uygulama)

**İstek:** Plan dosyasındaki DIC (Deterministic Identity-to-Conversion) mimarisinin uygulanması.

### Yapılanlar

| Bileşen | Dosya / Konum | Açıklama |
|--------|----------------|----------|
| **Schema** | `supabase/migrations/20260702000000_dic_attribution_schema.sql` | `calls.user_agent`, `calls.phone_source_type`, `sites.default_country_iso` (default 'TR') eklendi. |
| **Ingest** | `lib/ingest/process-call-event.ts` | `payload.ua` → `calls.user_agent` persist; `derivePhoneSourceType(payload)` ile `phone_source_type` (click_to_call vb.) set ediliyor. |
| **DIC Export RPC** | `supabase/migrations/20260703000000_dic_export_rpc.sql` | `get_dic_export_for_call(call_id, site_id)`: raw_phone_string, phone_source_type, detected_country_iso, event_timestamp_utc_ms, first_fingerprint_touch_utc_ms, user_agent_raw, historical_gclid_presence (90 gün). |
| **Redundant identities** | Aynı migration | `get_redundant_identities(site_id, days)`: Aynı fingerprint’e bağlı birden fazla farklı phone_number listesi. |
| **E.164 + Hash** | `lib/dic/e164.ts`, `lib/dic/identity-hash.ts`, `lib/dic/index.ts` | E.164 normalizasyon (ülke ISO + ham telefon); UTF-8 sabit, tuzlu SHA256 (hex/base64); `hashPhoneForEC`, `normalizeToE164` export. |
| **Dokümantasyon** | `docs/OPS/DIC_ECL_UTF8_ENCODING.md` | ECL pipeline UTF-8 only; Latin1 yok; nerede zorunlu (DB, hash girişi). |

### Değerlendirme Noktaları

- Ingest: Yeni call event’lerde `user_agent` ve `phone_source_type` gerçekten yazılıyor mu?
- DIC RPC: Verilen `call_id`/`site_id` için tek satır dönüyor mu; `first_fingerprint_touch_utc_ms` ve `historical_gclid_presence` mantığı doğru mu?
- E.164: TR/US vb. ülke kodlarıyla numara normalize ediliyor mu?
- Hash: Aynı E.164 + tuz → aynı SHA256 hex/base64 mi?

### E.164 Deep-Validation (Kritik Derinlik)

- **Karmaşık formatlar:** `0 (532) 123-4567`, `+90 532 123 45 67` gibi girişlerde tüm non-numeric karakterler temizlenmeli; çıktı tek ülke kodu (90) ile başlamalı.
- **Çift 90 engeli:** `0090 532 123 45 67` gibi girişlerde `9090532...` üretilmemeli; `905321234567` olmalı. `lib/dic/e164.ts` içinde leading 0 strip sonrası zaten country code ile başlıyorsa tekrar prefix eklenmiyor (düzeltme yapıldı).
- **Unit testler:** `tests/unit/dic-e164.test.ts` — 12 senaryo (TR/US/GB, çift 90, boş, geçersiz).

### Test Önerileri (DIC)

1. **Unit (Node):** `tests/unit/dic-e164.test.ts` — `normalizeToE164('0532 123 45 67', 'TR')` → `905321234567`; `0090 532...` → `905321234567` (no double 90); `+1 555 123 4567`, 'US' → `15551234567`.
2. **Unit (Node):** `lib/dic/identity-hash.ts` — `hashPhoneForEC('905321234567', 'salt')` tekrarlanınca aynı hex; UTF-8 dışı karakterde davranış.
3. **Integration (DB):** Migration’lar uygulandıktan sonra `get_dic_export_for_call` ve `get_redundant_identities` RPC’lerini gerçek `call_id`/`site_id` ile çağır; kolonların dolu/boş ve tiplerinin doğru olduğunu doğrula.
4. **Ingest:** Call-event worker’a `ua` ve `intent_action: 'phone'` içeren payload gönder; DB’de ilgili call satırında `user_agent` ve `phone_source_type` set mi kontrol et.

---

## 2. İkinci Prompt: Ultimate Forensic — Attribution Forensic Layer

**İstek:** “Diagnostic Attribution Engine” ve Causal Failure Trace; dönüşüm eşleşmediğinde “neden, nerede, hangi sinyal eksik” cevabını verebilecek export.

### Yapılanlar

| Bileşen | Dosya / Konum | Açıklama |
|--------|----------------|----------|
| **Forensic RPC** | `supabase/migrations/20260704000000_attribution_forensic_export.sql` | `get_attribution_forensic_export_for_call(call_id, site_id)`: DIC alanları + identity_resolution_score (0–1), touchpoint_entropy (14 gün UA/IP zinciri), cross_device_fingerprint_link, pre_normalization_snapshot, failure_mode (ORPHANED_CONVERSION / SIGNAL_STALE), clids_discarded_count. |
| **Dokümantasyon** | `docs/OPS/ATTRIBUTION_FORENSIC_LAYER.md` | RPC alanları, failure bucket’lar (ORPHANED, SIGNAL_STALE, HASH_MISMATCH, ATTRIBUTION_HIJACK), kullanım amacı. |

### RPC Çıktı Özeti

- **Signal Integrity:** identity_resolution_score, touchpoint_entropy (JSONB: user_agent, ip_address, created_at).
- **Shadow chain:** cross_device_fingerprint_link (multiple_fingerprints | ip_change | browser_update), pre_normalization_snapshot (raw phone + raw user_agent).
- **Failure mode:** ORPHANED_CONVERSION (fingerprint yok veya session yok), SIGNAL_STALE (ilk dokunuş 30 günden eski).
- **Çevre:** clids_discarded_count (bu call için FAILED queue’da INVALID_GCLID/decode/çözülemedi sayısı).

### Değerlendirme Noktaları

- RPC tek satır dönüyor mu; tüm kolonlar tanımlı tipte mi?
- identity_resolution_score: 10–15 rakam → 1.0, 7+ → 0.5 mantığı doğru mu?
- touchpoint_entropy: Aynı fingerprint’li session’lar 14 gün içinde mi; jsonb_agg sıralı mı?
- cross_device_fingerprint_link: Aynı telefonda birden fazla fingerprint / farklı IP veya UA durumunda doğru reason atanıyor mu?
- failure_mode: Fingerprint null veya session yokken ORPHANED_CONVERSION; 30 gün aşıldığında SIGNAL_STALE mi?
- clids_discarded_count: Bu call için FAILED + provider_error_code veya last_error kriteri doğru sayıyor mu?

### Test Önerileri (Forensic)

1. **SQL / RPC:** Migration uygulandıktan sonra bilinen bir `call_id`/`site_id` ile `get_attribution_forensic_export_for_call` çağır; dönen tek satırda identity_resolution_score, touchpoint_entropy, failure_mode, clids_discarded_count değerlerini manuel senaryolarla karşılaştır.
2. **Senaryo: ORPHANED_CONVERSION** — matched_fingerprint’i null olan veya 14/90 günde session’ı olmayan bir call ile RPC çağır; failure_mode = 'ORPHANED_CONVERSION' bekle.
3. **Senaryo: SIGNAL_STALE** — İlk dokunuşu 31+ gün önce olan bir call ile RPC çağır; failure_mode = 'SIGNAL_STALE' bekle.
4. **Senaryo: clids_discarded_count** — İlgili call için `offline_conversion_queue`’da FAILED + INVALID_GCLID veya decode içeren last_error ile bir kayıt oluştur; RPC’de clids_discarded_count >= 1 bekle.
5. **Senaryo: cross_device_fingerprint_link** — Aynı telefona sahip iki farklı fingerprint’li call veya aynı fingerprint’li session’larda farklı IP/UA ile link_reason’ın multiple_fingerprints / ip_change / browser_update dönmesini doğrula.

### Touchpoint Entropy (Kritik Derinlik)

- **ITP / GPC:** touchpoint_entropy içinde aynı session'da sürekli değişen IP'ler → kullanıcı büyük ihtimalle iCloud Private Relay veya VPN kullanıyordur; GCLID kaybı bu veriyle desteklenebilir.
- **Forensic Validator:** `CALL_ID=<uuid> SITE_ID=<uuid> node scripts/tests/forensic-smoke-test.mjs` veya env ile `npm run smoke:forensic`. Çıktıda failure_mode, identity_resolution_score, clids_discarded_count ve touchpoint uyarıları (çoklu IP/UA) gösterilir.

### Cross-Device Fingerprint Bridge

- **Senaryo:** Kullanıcı gündüz iş bilgisayarından tıkladı (Fingerprint A), akşam evde telefonundan aradı (Fingerprint B). `get_redundant_identities` aynı telefon numarası üzerinden iki farklı fingerprint'i listeler; Fingerprint A'daki GCLID'yi Fingerprint B'nin dönüşümüne "Bridge" olarak taşımak ileride eklenebilir.

---

## Özet Tablo

| Prompt | Ana çıktılar | Migration’lar | Kod (lib) | Doküman |
|--------|---------------|--------------|----------|---------|
| **1. DIC Plan** | Schema, ingest, DIC export, E.164/hash, UTF-8 | 20260702, 20260703 | process-call-event, lib/dic/* | DIC_ECL_UTF8_ENCODING.md |
| **2. Ultimate Forensic** | Forensic RPC, failure bucket’lar | 20260704 | — | ATTRIBUTION_FORENSIC_LAYER.md |

---

## Testleri Çalıştırma Sırası

1. Migration’ları uygula: `npx supabase db push` veya `npx supabase migration up`.
2. DIC unit testleri: `node --import tsx --test tests/unit/dic-e164.test.ts` (E.164 deep-validation); isteğe bağlı `hashPhoneForEC` testi eklenebilir.
3. Ingest testi: Call-event ile `ua` + intent gönderip DB’de user_agent ve phone_source_type kontrolü.
4. RPC testleri: `get_dic_export_for_call`, `get_redundant_identities`, `get_attribution_forensic_export_for_call` için en az birer gerçek call_id/site_id ile çağrı ve çıktı şeması + örnek değer doğrulaması.
5. Forensic senaryo testleri: Yukarıdaki ORPHANED, SIGNAL_STALE, clids_discarded, cross_device senaryolarını veri ile tekrarla.
6. **1500 TL case (meşhur gbraid-only kayıt):** İlgili `call_id` ile Forensic Validator çalıştır: `CALL_ID=... SITE_ID=... npm run smoke:forensic`. Sistemin "neden izlenemediğini" ve telefon numarası üzerinden Enhanced veri üretimini raporlaması beklenir.

Bu rapor, değerlendirme ve test planını birlikte hazırlamak için temel olarak kullanılabilir.
