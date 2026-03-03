# Dönüşüm Değer Hesaplama — Mantık Hataları & İkilemler (Derin Tarama)

**Amaç:** Tüm ikili kaynaklar, tutarsızlıklar ve potansiyel çatışmaların listesi.

---

## 0. İkilem Haritası (Özet)

| # | İkilem | Konum 1 | Konum 2 | Risk |
|---|--------|---------|---------|------|
| 1 | qualified oranı | intent_weights 20% | getBaseValueForGear V3 10% | Qualified 200→100 TL |
| 2 | intent_weights kullanımı | DB'de tanımlı | V2/V3/V4 emit'te YOK | Ölü config |
| 3 | AOV referansı | default_aov | oci_config.base_value | İki farklı "ortalama iş" |
| 4 | AOV fallback | DEFAULT_AOV 100, seal \|\| 100 | AOV_FLOOR_MAJOR 1000 | Farklı floor/varsayılan |
| 5 | Gün hesaplama | time-decay: ceil | value-calculator: floor | 0.5 gün → farklı decay |
| 6 | Oran sabiti (duplikasyon) | time-decay getBaseValueForGear | value-calculator RATIO_BY_GEAR | İki yerde değişiklik riski |
| 7 | leadScoreToStar | enqueue-seal-conversion | runner.ts | Kod duplikasyonu |
| 8 | value hesaplayıcı | calculateSignalEV (major) | calculateConversionValueMinor (minor) | İki SSOT iddiası |
| 9 | sealed eşlemesi | INTERMEDIATE+sealed→V4 | V5_SEAL = demir mühür | sealed V4 decay alıyor |
| 10 | value_cents yazım yolu | enqueue (insert) | syncQueueValuesFromCalls (send öncesi) | İki yazıcı, son yazan kazanır |
| 11 | Yıldız vs lead_score | oci_config star 1–5 | UI lead_score 0–100 | Operatör "yıldız" görmez |

---

## 1. Üç Paralel Sistem

| Sistem | Kaynak | Kullanım | Oranlar |
|--------|--------|----------|---------|
| **intent_weights** | `sites.intent_weights` | DB'de var, `calculateConversionValue` sadece clickDate yoksa kullanır | pending 2%, qualified **20%**, sealed 100% |
| **getBaseValueForGear** | `lib/domain/mizan-mantik/time-decay.ts` | V2/V3/V4 marketing_signals (seal, process-call-event) | V2: 2%, V3: **10%**, V4: 30% |
| **oci_config** | `sites.oci_config` | V5 Seal, offline_conversion_queue | base_value × weights[star], star=3/4/5 |

---

## 2. Mantık Hatası #1 — qualified %20 vs V3 %10

**Beklenen:** Görüşüldü (qualified) = AOV × %20 = 1000 × 0.20 = **200 TL**

**Gerçek:** `getBaseValueForGear(V3_ENGAGE, 1000)` = 1000 × 0.10 = **100 TL**

- `intent_weights.qualified = 0.20` DB'de tanımlı
- V3_ENGAGE = Görüşüldü (lead_score 60)
- Ama V3/V4 emit `getBaseValueForGear` kullanıyor — **intent_weights kullanılmıyor**
- Sonuç: Qualified için 200 TL yerine 100 TL gidiyor

---

## 3. Mantık Hatası #2 — intent_weights fiilen devre dışı

`calculateConversionValue` (mizan-mantik.ts):

- `clickDate` **varsa** → `calculateSignalEV(gear, aov, ...)` çağrılır → `getBaseValueForGear` (sabit 2%, 10%, 30%)
- `clickDate` **yoksa** → `base = aov × intent_weights[stage]` kullanılır

V2/V3/V4 emit (seal route, process-call-event) her zaman `evaluateAndRouteSignal` → `calculateSignalEV` kullanıyor; `intent_weights` hiç geçmiyor. Yani **sites.intent_weights değerleri V2/V3/V4 için kullanılmıyor**.

---

## 4. Mantık Hatası #3 — Yıldız vs lead_score

- **oci_config:** `base_value × weights[star]`, star = 1–5
- **UI:** Yıldız yok; operatör `lead_score` (0–100) giriyor
- **Dahili eşleme:** `star = round(lead_score / 20)` → 60→3, 80→4, 100→5

Bunlar tutarlı ama dokümante değil; UI "yıldız" göstermediği için operatör ne girdiğini tam anlamıyor.

---

## 5. Mantık Hatası #4 — default_aov vs oci_config.base_value

- **V2/V3/V4:** `sites.default_aov` (ör. 1000)
- **V5 Seal (sale_amount yok):** `oci_config.base_value` (varsayılan 500)

Aynı site için AOV 1000, Seal base 500 olabiliyor — iki farklı referans değer.

---

## 6. Özet Tablo (AOV=1000)

| Etiket | intent_weights | getBaseValueForGear | Fiili değer (0–3 gün decay) |
|--------|----------------|---------------------|-----------------------------|
| Pending / V2 | 2% → 20 TL | 2% → 20 TL | 10 TL (decay ×0.5) |
| Qualified / V3 | **20% → 200 TL** | **10% → 100 TL** | **50 TL** (200 değil) |
| Teklif / V4 | — | 30% → 300 TL | 150 TL |

**Özet:** Qualified için beklenen 200 TL yerine 50 TL (decay sonrası) veya 100 TL (base) gidiyor.

---

## 7. İkilem Detayları

### 7.1 Gün hesaplama — ceil vs floor

- `time-decay.ts`: `ceil(elapsedMs / 86400000)` — 0.5 gün → 1 gün
- `value-calculator.ts`: `floor(diffMs / 86400000)` — 0.5 gün → 0 gün

### 7.2 AOV fallback zinciri

- mizan-mantik DEFAULT_AOV = 100
- seal/process-call-event `|| 100`
- value-calculator AOV_FLOOR_MAJOR = 1000

### 7.3 leadScoreToStar — enqueue-seal-conversion + runner.ts duplikasyonu

### 7.4 value_cents — enqueue (insert) + syncQueueValuesFromCalls (send öncesi) iki yazıcı

---

## 8. Önerilen Düzeltmeler

1. **getBaseValueForGear V3 oranını %20 yap**  
   `time-decay.ts`: V3_ENGAGE → `safeAov * 0.2` (0.1 yerine)
2. **Ya da intent_weights'i V2/V3/V4'e taşı**  
   `getBaseValueForGear` yerine `sites.intent_weights` kullan; pending/qualified/sealed ile hizala
3. **default_aov ve oci_config.base_value'yu senkronize et**  
   Örn. `oci_config` yoksa `base_value = default_aov` varsay
4. **Doc güncelle** — intent_weights vs gear oranları, yıldız eşlemesi
5. **Gün hesaplama** — ceil vs floor tekilleştir
6. **leadScoreToStar** — shared util
7. **RATIO_BY_GEAR** — time-decay'den export  
   intent_weights vs gear oranları ve "yıldız" eşlemesi runbook'ta net yazılsın

---

## 9. Value SSOT Contract (PR-VK-1 … VK-8 Sonrası)

PR zinciri tamamlandı. Aşağıdaki kurallar artık geçerlidir.

### 9.1 Value SSOT Anayasası (Golden Rules)

| Kural | Tanım | Teknik Karşılık |
|-------|-------|-----------------|
| **A** Single Config Source | Oranlar asla kodda (.ts) yazılmaz; her zaman DB üzerinden okunur | `getSiteValueConfig`; sites.intent_weights, sites.default_aov |
| **B** Single Time Math | Gün farkı hesaplamaları tek fonksiyonla yapılır | `calculateDecayDays` (mode: ceil, clamp: 365) |
| **C** Single Writer | value_cents sadece enqueue anında yazılır | sync sadece denetim (alert); overwrite yasak |
| **D** Integer Only Math | Tüm iç hesaplamalar cents (kuruş) biriminde yapılır | BIGINT / integer; float sadece export aşamasında |
| **E** Consistent Mapping | Gear ↔ Stage eşleşmesi sabittir | V3→qualified; intent_weights bu isimlendirmeyi takip eder |

### 9.2 Değer ve Oran Hiyerarşisi (AOV = 1000 TRY Örneği)

| Etiket (Stage) | Gear | Ratio (Weight) | Taban Değer (Cents) | 3 Gün Sonraki Değer |
|----------------|------|----------------|---------------------|----------------------|
| Pending | V2 | 0.02 | 2,000 | 1,000 (decay ×0.5) |
| Qualified | V3 | 0.20 | 20,000 | 10,000 |
| Proposal | V4 | 0.30 | 30,000 | 15,000 |
| Sealed | V5 | 1.00 | 100,000 | 100,000 (No decay) |

**Not:** 3 gün için `getDecayProfileForGear` multiplier = 0.5 (days ≤ 3).

### 9.3 Cursor Kuralı

`.cursor/rules/value-ssot.mdc` — AI asistanı ve geliştiriciler için enforcement kuralları.
