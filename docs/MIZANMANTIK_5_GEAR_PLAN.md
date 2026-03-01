# MizanMantik 5-Gear Architecture — Uygulama Planı

**Tarih:** 2026-02-25  
**Hedef:** MizanMantik'i basit matematik yardımcısından Domain Orchestrator'a yükseltmek.

---

## 1. Yanlış Anlama Özeti

**Önceki yaklaşım:** MizanMantik sadece `calculateDecayedValue(baseValue, clickDate, signalDate)` ile time-decay hesaplayan bir yardımcı olarak görülüyordu.

**Gerçek felsefe:**
- **Mizan** = Ölçek/Denge (terazi)
- **Mantik** = Mantık
- MizanMantik = **Gatekeeper ve Ledger Router** — sistemin ruhu
- Zaman aşımı sadece ara dişlilerde (V2–V4) kullanılan bir argüman
- V5_SEAL için zaman yok — Iron Seal, mutlak doğruyu ledgere yazar

---

## 2. 5-Gear OpsMantik Sistemi

| Gear | İsim | Hedef | Base Value | Decay | Routing |
|------|------|-------|------------|-------|---------|
| **V1** | PAGEVIEW | Redis volume | 0 (hard) | — | Redis `pv:queue` |
| **V2** | PULSE | Erken funnel | AOV × 2% | Soft | marketing_signals |
| **V3** | ENGAGE | Orta funnel | AOV × 10% | Standard | marketing_signals |
| **V4** | INTENT | Derin funnel | AOV × 30% | Aggressive | marketing_signals |
| **V5** | SEAL | Ledger (Iron Seal) | Exact value_cents | Bypass (no decay) | offline_conversion_queue / revenue_snapshots |

---

## 3. Decay Profilleri (Fast-Closer Bias)

| Gear | 0–3 gün | 4–10 gün | >10 gün |
|------|---------|----------|---------|
| **V2 (Soft)** | 0.50 | 0.30 | 0.15 |
| **V3 (Standard)** | 0.50 | 0.25 | 0.10 |
| **V4 (Aggressive)** | 0.50 | 0.20 | 0.05 |

Erken funnel (V2) yumuşak soğur; derin funnel (V4) agresif soğur — Smart Bidding’e "yakın dönüşüm daha değerli" sinyali verir.

---

## 4. Anti-Spam (Deduplication)

**V2_PULSE için:**  
Aynı `call_id` veya `(site_id, gclid)` ile son 24 saat içinde zaten bir V2_PULSE varsa → sessizce drop (null dön). Smart Bidding kirlenmesini önler.

---

## 5. MizanMantik Orchestrator — Davranış

```
evaluateAndRouteSignal(gear, payload)
├── V1_PAGEVIEW  → Redis pv:queue (value=0), bypass decay
├── V2_PULSE     → [dedup check] → marketing_signals (Soft decay)
├── V3_ENGAGE    → marketing_signals (Standard decay)
├── V4_INTENT    → marketing_signals (Aggressive decay)
└── V5_SEAL      → offline_conversion_queue / revenue_snapshots (no decay, absolute value)
```

---

## 6. Dosya Yapısı

```
lib/domain/mizan-mantik/
├── orchestrator.ts     # Ana router: evaluateAndRouteSignal
├── time-decay.ts       # getBaseValueForGear, getDecayProfileForGear, calculateSignalEV
└── types.ts            # OpsGear, SignalPayload, vb.
```

**Eski:** `lib/utils/mizan-mantik.ts` → deprecate veya orchestrator’a yönlendir.

---

## 7. API Değişiklikleri

| Yer | Önce | Sonra |
|-----|------|-------|
| `signal-emitter.ts` | `emitSignal(params)` | `MizanMantikOrchestrator.evaluateAndRouteSignal(gear, payload)` |
| `track/pv/route.ts` | Direkt Redis | `evaluateAndRouteSignal(V1_PAGEVIEW, ...)` veya mevcut akış korunur (V1 Redis’e gider, value=0) |
| `google-ads-export` | `calculateConversionValue` | Orchestrator’dan gelen mantıkla uyumlu hale getir |
| `seal route` / enqueue | value_cents | V5_SEAL olarak orchestrator üzerinden ledger’a yaz |

---

## 8. Uygulama Adımları

1. **lib/domain/mizan-mantik/types.ts**  
   OpsGear, SignalPayload, EvaluateResult tipleri.

2. **lib/domain/mizan-mantik/time-decay.ts**  
   - getBaseValueForGear(gear, aov)  
   - getDecayProfileForGear(gear, days)  
   - calculateSignalEV(gear, aov, clickDate, signalDate)

3. **lib/domain/mizan-mantik/orchestrator.ts**  
   - evaluateAndRouteSignal(gear, payload)  
   - V1 → Redis (value=0)  
   - V2–V4 → marketing_signals (dedup V2)  
   - V5 → ledger (value_cents, no decay)

4. **lib/services/signal-emitter.ts**  
   - gear: OpsGear, aov, clickDate, signalDate al  
   - Orchestrator.evaluateAndRouteSignal çağır  
   - V2 dedup: call_id veya (site_id, gclid) + son 24h kontrolü

5. **lib/utils/mizan-mantik.ts**  
   - Deprecate veya orchestrator’a re-export  
   - Mevcut `calculateConversionValue` export route için kalsın; iç mantığı 5-gear’a göre güncelle

6. **Export route**  
   - Orchestrator/5-gear mantığıyla uyumlu conversion value hesaplama

---

## 9. Eşleştirme: Mevcut → 5-Gear (Funnel Hizalaması)

Google’ı adım adım beslemek için doğru eşleştirme:

| Mevcut | Yeni Gear | Gerekçe |
|--------|-----------|---------|
| **INTENT_CAPTURED** (Ham Form/Çağrı) | **V2_PULSE** | Henüz ham nabız, operatör süzgecinden geçmemiş. Yumuşak soğur. |
| **MEETING_BOOKED** (Randevu/Keşif) | **V3_ENGAGE** | Operatör konuştu, bot olmadığı doğrulandı, nitelikli temas. |
| **SEAL_PENDING** (Ödeme Bekleniyor) | **V4_INTENT** | Fiyat verildi, cüzdan masada. En agresif soğumayı buraya vuruyoruz — hızlı kapatanları bulmak için. |
| **Ops_PageView** (Redis PV) | **V1_PAGEVIEW** | Şok cihazı — volume sinyali, value=0. |
| **offline_conversion_queue** (Seal) | **V5_SEAL** | Demir Mühür — mutlak değer, ledgere kilitlenir. |

---

*Bu plan, MizanMantik’in Gatekeeper/Ledger Router rolüne göre yazılmıştır.*
