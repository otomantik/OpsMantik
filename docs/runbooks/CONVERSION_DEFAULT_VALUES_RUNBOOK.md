# Dönüşüm Varsayılan Değerler — V2/V3/V4/V5 Mantık Özeti

**Amaç:** Site bazında varsayılan conversion value hesaplama mantığı ve Muratcan Akü (ortalama iş 1200 TL) için önerilen ayarlar.

---

## 1. Lead Score → Star Mapping

| lead_score | Star | Anlam |
|------------|------|-------|
| 20 | 1 | Düşük niyet |
| 40 | 2 | |
| 60 | 3 | Görüşüldü (V3_ENGAGE) |
| 80 | 4 | Teklif (V4_INTENT) |
| 100 | 5 | Satış (V5_SEAL) |

Formül: `star = round(lead_score / 20)` (0-100 → 0-5, 0 hariç 1-5)

---

## 2. V2 / V3 / V4 (marketing_signals) — AOV tabanlı

**Kaynak:** `sites.default_aov` (varsayılan: 100)

| Gear | Açıklama | Base Value | Decay (0-3 gün / 4-10 gün / >10 gün) |
|------|----------|------------|--------------------------------------|
| V2_PULSE | Ham form/çağrı | AOV × 2% | 0.50 / 0.30 / 0.15 |
| V3_ENGAGE | Görüşüldü (lead_score=60) | AOV × 10% | 0.50 / 0.25 / 0.10 |
| V4_INTENT | Teklif (lead_score=80) | AOV × 30% | 0.50 / 0.20 / 0.05 |

**EV = Base × Decay** (TL, 2 ondalık)

### Muratcan Akü (AOV = 1200 TL)

| Gear | Base | 0-3 gün | 4-10 gün | >10 gün |
|------|------|---------|----------|---------|
| V2_PULSE | 24 TL | 12 TL | 7,2 TL | 3,6 TL |
| V3_ENGAGE | 120 TL | 60 TL | 30 TL | 12 TL |
| V4_INTENT | 360 TL | 180 TL | 72 TL | 18 TL |

---

## 3. V5 (offline_conversion_queue) — Seal / Satış

**Kaynak:** `sites.oci_config` (JSONB) veya varsayılan:

- `base_value`: 500 TRY
- `min_star`: 3 (3 yıldız altı enqueue edilmez)
- `weights`: { 3: 0.5, 4: 0.8, 5: 1.0 }

**Değer mantığı:**
1. `sale_amount > 0` → Gerçek satış fiyatı kullanılır.
2. `sale_amount` yok/0 → `base_value × weights[star]` (star ≥ min_star gerekli).

| Star | Varsayılan (base=500) | Muratcan (base=1200 önerisi) |
|------|------------------------|------------------------------|
| 3 | 250 TRY | 600 TRY |
| 4 | 400 TRY | 960 TRY |
| 5 | 500 TRY | 1200 TRY |

---

## 4. Sitelerin Mevcut Durumu (SQL)

Supabase SQL Editor'da çalıştır:

```sql
-- Tüm siteler: default_aov, oci_config
SELECT
  s.id,
  s.public_id,
  s.name,
  s.default_aov,
  s.oci_config,
  s.intent_weights
FROM sites s
ORDER BY s.created_at DESC;
```

### Muratcan Akü için önerilen güncelleme

Site ID: `c644fff7-9d7a-440d-b9bf-99f3a0f86073`

```sql
-- default_aov = 1200 (ortalama iş değeri)
UPDATE sites
SET default_aov = 1200
WHERE id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';

-- oci_config: base_value 1200, weights 3/4/5 (V5 Seal için)
UPDATE sites
SET oci_config = jsonb_build_object(
  'base_value', 1200,
  'currency', 'TRY',
  'min_star', 3,
  'weights', '{"3": 0.5, "4": 0.8, "5": 1.0}'::jsonb
)
WHERE id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';
```

---

## 5. "Niyet 7,5" Yorumu

"niyet 7,5" muhtemelen 10 üzerinden 7.5 = **75 lead_score** (≈4 yıldız) demektir. Bu durumda:
- V4_INTENT (Teklif) seviyesi
- Base value: 1200 × 0.30 = 360 TL
- Time decay ile 0–3 gün içinde: 180 TL

---

## 6. Özet Tablo (Muratcan, AOV=1200)

| Etiket | Gear | Ne zaman | Örnek value (0-3 gün) |
|--------|------|----------|------------------------|
| Ham çağrı/form | V2_PULSE | Call-event oluşunca | 12 TL |
| Görüşüldü | V3_ENGAGE | Seal, lead_score=60 | 60 TL |
| Teklif | V4_INTENT | Seal, lead_score=80 | 180 TL |
| Satış | V5_SEAL | Seal, lead_score=100, sale_amount | Gerçek tutar veya base×weight |
