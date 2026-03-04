# V3 Nitelikli Görüşme — Neden 1000 TL Görünüyordu, Matematik

## Bizim matematik (sinyal değeri)

- **V3_ENGAGE** (Nitelikli Görüşme): `finalCents = AOV × qualified_oran × decay(gün)`
- **qualified oran:** `intent_weights.qualified` (varsayılan **0.2** = %20)
- **Decay (V3 Standard):** gün ≤3 → 0.5; gün ≤10 → 0.25; sonrası 0.1
- **Örnek:** AOV = 1000 TRY, gün = 0 → 1000 × 0.2 × 0.5 = **100 TRY**

Yani matematiğe göre V3 genelde **100–200 TRY** bandında olmalı (satış değil, sinyal).

## Neden 1000 TL geliyordu?

- **Floor:** `finalCents = max(hesaplanan, floorCents)`
- **floorCents:** `max(min_conversion_value_cents, default_aov × 0.005 × 100)`
- Varsayılan **min_conversion_value_cents = 100000** (1000 TRY)
- Sonuç: Hesaplanan 10000 (100 TRY) < 100000 → **finalCents = 100000 → 1000 TRY**

Yani **floor çok yüksekti**; tüm sinyaller en az 1000 TRY’ye çekiliyordu.

## Yapılan düzeltme

1. **Muratcan için floor düşürüldü:** `min_conversion_value_cents = 5000` (50 TRY)  
   Migration: `20260709000000_muratcan_signal_floor_50_try.sql`
2. **Mevcut PENDING V3 sinyaller:** `conversion_value` matematiğe göre güncellendi (örn. 100 TRY).  
   Script: `scripts/db/oci-muratcan-v3-value-fix.mjs`

## Dönüşüm adları (referans)

| Gear | Dönüşüm adı | Kaynak | Değer |
|------|-------------|--------|------|
| V5 | OpsMantik_V5_DEMIR_MUHUR | offline_conversion_queue | sale_amount veya default_aov |
| V3 | OpsMantik_V3_Nitelikli_Gorusme | marketing_signals | AOV × 0.2 × decay |
| V2 | OpsMantik_V2_Ilk_Temas | marketing_signals | AOV × 0.02 × decay |
| V4 | OpsMantik_V4_Sicak_Teklif | marketing_signals | AOV × 0.3 × decay |
