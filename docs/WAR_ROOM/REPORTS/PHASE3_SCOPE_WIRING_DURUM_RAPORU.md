# Phase 3 – Scope Toggle (Data Wiring) Durum Raporu

**Tarih:** 2025-01-29  
**Hedef:** ADS ONLY / ALL TRAFFIC toggle’ının veri katmanına tam bağlanması, canlıya alma öncesi mutabakat.

---

## 1. Özet

- **Scope toggle** (ADS ONLY ↔ ALL TRAFFIC) artık hem **Kuyruk (Queue)** hem de **Skor tablosu (Captured / Filtered / Saved)** verisini yönlendiriyor.
- Toggle değiştiğinde her iki veri kaynağı da **anında yeniden çekiliyor**; ek bir buton gerekmiyor.

---

## 2. Yapılan Değişiklikler

### 2.1 Stats hook – scope parametresi

**Dosya:** `lib/hooks/use-command-center-p0-stats.ts`

| Önceki | Sonraki |
|--------|--------|
| `p_ads_only: true` sabit | `scope` parametresine göre: `scope === 'ads'` → `p_ads_only: true`, `scope === 'all'` → `p_ads_only: false` |
| 2 parametre: `siteId`, `rangeOverride` | 3. parametre eklendi: `options?: { scope?: 'ads' \| 'all' }` |
| — | `adsOnly` değeri `fetchStats` dependency listesinde; scope değişince otomatik refetch |

- Varsayılan scope: `'ads'`. Mevcut tek argümanlı kullanımlar (örn. `CommandCenterP0Panel`) değişmedi.

### 2.2 Shell – scope’un stats’a iletilmesi

**Dosya:** `components/dashboard-v2/DashboardShell.tsx`

- `useCommandCenterP0Stats(siteId, range, { scope })` çağrısı güncellendi.
- Header’daki skor tablosu (Captured, Filtered, Saved) artık seçilen scope’a göre hesaplanan RPC sonucunu gösteriyor.

### 2.3 Kuyruk (QualificationQueue)

**Dosya:** `components/dashboard-v2/QualificationQueue.tsx`

- Zaten `scope` prop’u alıyordu ve `fetchUnscoredIntents` içinde `adsOnly = scope === 'ads'` kullanılıyordu.
- `fetchUnscoredIntents` dependency’sinde `scope` olduğu için toggle değişince effect tetikleniyor, kuyruk listesi yeniden çekiliyor.
- Bu dosyada ek değişiklik yapılmadı; sadece doğrulandı.

---

## 3. Davranış Özeti

| Kullanıcı aksiyonu | Kuyruk (kart listesi) | Skor tablosu (Captured / Filtered / Saved) |
|--------------------|------------------------|--------------------------------------------|
| **ADS ONLY** seçili | Sadece reklam-attribution’lı çağrılar | Sadece reklam trafiği istatistikleri |
| **ALL TRAFFIC** seçili | Tüm çağrılar (organik + reklam) | Tüm trafik istatistikleri (Captured genelde artar) |
| Toggle değiştirme | Anında refetch, liste güncellenir | Anında refetch, sayılar güncellenir |

- **Yesterday / Today** toggle’ı önceden olduğu gibi hem kuyruk hem stats için range’i belirliyor; scope ile birlikte çalışıyor.

---

## 4. Backend Gereksinimleri

- **RPC:** `get_command_center_p0_stats_v1` zaten `p_ads_only` parametresi alıyor; frontend artık bunu scope’a göre gönderiyor.
- **Queue RPC’ler:** `get_recent_intents_v2` / `get_recent_intents_v1` zaten `p_ads_only` destekliyor; değişiklik yok.

Backend tarafında ek migration veya RPC değişikliği **gerekmiyor**.

---

## 5. Eksik / Risk Kontrol Listesi

| Madde | Durum |
|-------|--------|
| Scope state tek yerde (DashboardShell) | ✅ |
| Scope → Stats hook’a iletilmesi | ✅ |
| Scope → Queue’ya iletilmesi | ✅ (zaten vardı) |
| Toggle değişince refetch (stats) | ✅ (dependency: `adsOnly`) |
| Toggle değişince refetch (queue) | ✅ (dependency: `scope`) |
| Varsayılan scope ADS | ✅ |
| Mevcut diğer kullanımlar bozulmuyor | ✅ (CommandCenterP0Panel tek argümanlı, default scope) |
| Lint / TypeScript hata | ✅ Kontrol edildi, temiz |

---

## 6. Canlıya Alma Öncesi Önerilen Kontroller

1. **Manuel test (site seçili):**
   - ADS ONLY’de Captured / Filtered / Saved ve kuyruk kart sayısını not al.
   - ALL TRAFFIC’e geç; Captured (ve varsa kuyruk sayısı) artmalı (organik trafik varsa).
   - Tekrar ADS ONLY’e geç; sayılar önceki ADS ONLY değerlerine dönmeli.
2. **Realtime:** Header’daki LIVE badge şu an `adsOnly: true` ile dinliyor; scope toggle’dan bağımsız. İstenirse ileride “ALL” seçiliyken tüm trafik için de pulse gösterecek şekilde genişletilebilir; canlı çıkış için zorunlu değil.

---

## 7. Sonuç

- **Phase 3 (Data Wiring – Scope Toggle)** tamamlandı.
- Scope state `DashboardShell`’den hem stats hook’una hem queue’ya iletilmiş durumda; toggle değişince hem skor tablosu hem kuyruk anında güncelleniyor.
- Eksik veya mutabakat gerektiren bir nokta yok; onay sonrası canlıya alınabilir.

---

*Rapor: PHASE3_SCOPE_WIRING – Hunter Terminal / Command Center V2*
