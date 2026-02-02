# 👻 Hayalet Avcısı (Ghostbuster) Raporu

**Tarih:** 2026-01-29  
**Amaç:** Zombie / Dead Code tespiti ve temizliği — "Büyük Temizlik" kapsamında evden atılan ölü kodlar.

---

## 1. Script: `scripts/find-zombies.mjs`

**Kullanım:**
```bash
node scripts/find-zombies.mjs
```

**Aranan kelimeler:** `call_alert`, `callAlert`, `panel_v1`, `dashboard-old`, `legacy`, `deprecated`, `old_system`  
**Hariç tutulanlar:** `node_modules`, `.next`, `.git`, `dist`, `build`, `migrations`, ve script'in kendisi.

---

## 2. Yapılan Temizlikler

### 2.1 Ölü importlar — `app/dashboard/page.tsx`

Dashboard kök sayfası artık sadece Site Switcher / SitesManager gösteriyor; eski panelden kalan aşağıdaki importlar **hiç render edilmiyordu**. Kaldırıldı:

| Kaldırılan import | Sebep |
|-------------------|--------|
| `StatsCards` | Sayfada kullanılmıyor (1 site → redirect, çok site → SiteSwitcher + SitesManager) |
| `LiveFeed` | Aynı |
| `CallAlertWrapper` | Aynı — eski "modal atan" call alert paneli |
| `TrackedEventsPanel` | Aynı |
| `ConversionTracker` | Aynı |

### 2.2 Zombi bileşenler — tamamen silindi

**CallAlert** / **CallAlertWrapper** artık hiçbir sayfadan import edilmiyordu (sadece kaldırdığımız `app/dashboard/page.tsx` import ediyordu). Yeni dashboard (DashboardShell v2, QualificationQueue, HunterCard) kullanılıyor; eski "detaylı modal atan" call alert paneli işi bozduğu için kaldırıldı.

| Silinen dosya | Açıklama |
|---------------|----------|
| `components/dashboard/call-alert.tsx` | Tek kullanıcı: call-alert-wrapper. Referans: 0. |
| `components/dashboard/call-alert-wrapper.tsx` | Tek kullanıcı: app/dashboard/page.tsx (import kaldırıldı). Referans: 0. |

**Güncelleme:** `scripts/verify-architecture.js` içindeki component listesinden bu iki dosya çıkarıldı.

---

## 3. find-zombies çıktısı (referans)

Script çalıştırıldığında **kod tabanında** (migrations ve script hariç) hâlâ şu dosyalarda "legacy" / "deprecated" geçiyor; bunlar **bilinçli kullanım** (geriye uyumluluk, yorum, dokümantasyon):

| Dosya | Kelime | Not |
|-------|--------|-----|
| `app/api/sync/route.ts` | legacy | Back-compat: eski action/label → phone/wa sinyali |
| `app/dashboard/site/[siteId]/page.tsx` | legacy | V1 (legacy) vs V2 dashboard branch yorumu |
| `components/dashboard-v2/cards/IntentCard.tsx` | legacy | Quick score picker yorumu |
| `lib/hooks/use-dashboard-stats.ts` | deprecated | Backward-compat yorumu |
| `lib/hooks/use-intent-qualification.ts` | legacy | 1–5 → 20–100 skor uyumluluğu |
| `lib/hooks/use-realtime-dashboard.ts` | legacy | Non-ads mode yorumu |
| `components/dashboard-v2/reset.css` | legacy | CSS yorumu |
| `scripts/smoke/stamp-idempotency-proof.mjs` | legacy | Test verisi açıklaması |

---

## 3b. V1 tamamen kaldırıldı (yayındaki ekran sadece v2)

**Tarih:** 2026-01-29 (ikinci tur)

- **`app/dashboard/site/[siteId]/page.tsx`:** Feature flag ve legacy dal kaldırıldı; sadece `DashboardShell` (yayındaki ekran) render ediliyor.
- **Silinen V1 dosyaları:** `dashboard-layout.tsx`, `dashboard-tabs.tsx`, `stats-cards.tsx`, `live-feed.tsx` — artık hiçbir sayfa bu zinciri kullanmıyor.
- **`scripts/verify-architecture.js`:** Liste güncellendi (live-feed, stats-cards çıkarıldı; DashboardShell eklendi).

---

## 4. İmha prosedürü (gelecek kullanım)

- **Tam dosya:** Referans yoksa → SİL. Referans varsa → Önce import eden yeri temizle, sonra dosyayı sil.
- **Kod parçası:** İlgili bloğu seç ve SİL.
- **Veritabanı tablosu:** Şimdilik silme; adını `old_*` veya `archived_*` yap. 1 ay sonra kullanılmıyorsa sil.

---

## 5. Tekrar çalıştırma

```bash
node scripts/find-zombies.mjs
```

Temizlik sonrası yeni zombi tespiti için script’i periyodik çalıştırabilirsin.
