# Muratcan OCI: Conversion Time Hatası — Kök Neden Analizi

**Tarih:** 25 Şubat 2026  
**Sorun:** `'Conversion time' sütununda '2026-03-01 22:23:13+03:00' değeri geçersiz` — 5 dönüşüm vardı, sadece 1 gönderilmeye çalışıldı.

---

## 1. Özet Bulgu

| Soru | Cevap |
|------|-------|
| Neden `+03:00` geçersiz? | Google Ads CSV bulk import **kolon içermeyen** offset bekler: `+0300` (doğru), `+03:00` (yanlış) |
| Neden 5 yerine 1 gönderildi? | Script validator `+03:00` formatını INVALID_TIME_FORMAT ile eledi — API `+03:00` gönderdiyse 4 satır atlanır, 1 satır farklı nedenle (örn. farklı zaman dilimi/env) geçmiş olabilir |
| Eslamed neden çalıştı? | Aynı backend; muhtemel: Eslamed script farklı zaman diliminde çalıştı veya eski deploy’dan kalan doğru format kullanıldı |

---

## 2. Kök Neden: Intl `longOffset` + Ortam Farkı

### 2.1 Format Gereksinimi

- **Google Ads CSV:** `yyyy-mm-dd HH:mm:ss+0300` (offset 4 rakam, **kolon yok**)
- **Intl.DateTimeFormat longOffset:** `GMT+3:00` döner (kolonlu)
- Kod regex ile `+03:00` → `+0300` çeviriyor; bazı ortamlarda (Node/Vercel) bu dönüşüm tutarlı çalışmayabiliyor.

### 2.2 Yapılan Düzeltme (`lib/utils/format-google-ads-time.ts`)

1. **Fallback:** Regex eşleşmezse `raw.replace(/:/g, '')` ile kolonlar kaldırılıyor.
2. **Defensive sanitization:** Offset çıktısında kolon varsa `offset.replace(/:/g, '')` ile siliniyor.

Bu iki değişiklik, farklı Intl çıktılarında bile her zaman `+0300` formatının üretilmesini sağlar.

---

## 3. 5’ten 1 Gönderilme — Olası Senaryolar

### Senaryo A: Validator 4 satırı eledi

- Script validator: `Validator.isValidGoogleAdsTime(row.conversionTime)` → regex `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{4}$/` (yani `+0300` bekler).
- API `+03:00` gönderirse bu regex başarısız olur → `INVALID_TIME_FORMAT` → satır atlanır.
- 4 satır atlanır, 1 satır (farklı format veya eski cache) geçer kabul edilip gönderilir.

### Senaryo B: Session deduplication

- Export tarafında session bazlı dedup var; aynı session için tek satır çıkıyor.
- Muratcan’da 5 farklı session vardı; bu senaryo 5→1 azalmasını tek başına açıklamaz.

### Senaryo C: Deterministic sampling (V1 için)

- V1_PAGEVIEW için %10 sampling var; Seal (V5) için yok. Muratcan Seal kullanıyorsa bu da 5→1’i açıklamaz.

**En olası açıklama:** Senaryo A — API `+03:00` döndürdü, script 4 satırı INVALID_TIME_FORMAT ile eledi, 1 satır (başka nedenle geçer) gönderildi.

---

## 4. Yapılacaklar

1. **Backend deploy:** `format-google-ads-time.ts` değişikliğini deploy et.
2. **FAILED satırları yeniden kuyruğa al:**  
   `node scripts/db/oci-enqueue.mjs Muratcan --force-reset-completed`
3. **Script çalıştır:** Google Ads Script Editor’da Muratcan Quantum script’i tetikle.
4. **Doğrulama:** Export API cevabında `conversionTime` değerlerinin `+0300` (kolonsuz) olduğunu kontrol et.

---

## 5. Eslamed vs Muratcan — Fark Ne?

| Alan | Eslamed | Muratcan |
|------|---------|----------|
| Backend | Aynı (`formatGoogleAdsTimeOrNull`) | Aynı |
| Script engine | Quantum v3.0 | Quantum v3.0 |
| Olası fark | Zaman dilimi/env | Zaman dilimi/env |

İkisi de aynı backend’i kullanıyor. Format hatası ortam/Intl davranışından kaynaklanıyor olabilir. Defensive fix her iki site için de geçerli olacak.
