# Canlıya Alma — Komutlar

**Tarih:** 2026-01-29  
**Amaç:** Tüm güncel değişiklikleri commit edip push ile Vercel’de otomatik deploy tetiklemek.

---

## 1. Terminalde çalıştır

Proje kökünde (opsmantik-v1) şu komutları sırayla çalıştır:

```bash
cd "c:\Users\serka\OneDrive\Desktop\project\opsmantik-v1"

# Tüm değişiklikleri stage et
git add -A

# Commit (audit cleanup, ghostbuster, V1 kaldırma, debugLog, sync-utils)
git commit -m "chore: canlıya al - audit cleanup, ghostbuster, V1 kaldırma, debugLog/sync-utils"

# Vercel otomatik deploy tetikler (master/main branch’e push)
git push
```

---

## 2. Push sonrası

- **Vercel Dashboard** → [Deployments](https://vercel.com/dashboard) → en son deployment’ın “Building” → “Ready” olmasını bekle (2–5 dk).
- Canlıyı test et: **gizli pencere** ile canlı URL’i aç (cache’siz görürsün).
- Gerekirse: Vercel → Deployments → son commit’in **⋯** → **Redeploy** (“Use existing Build Cache” **kapalı**).

---

## 3. Bu deploy’da giden değişiklikler (özet)

| Alan | Değişiklik |
|------|------------|
| **Ghostbuster** | CallAlert/V1 panel kaldırıldı, dashboard sadece DashboardShell v2 |
| **Audit** | API route’larda `debugLog`/`debugWarn`, prod’da log gürültüsü azaldı |
| **Spaghetti** | `lib/sync-utils.ts` eklendi, sync/call-event ortak kullanıyor |
| **Raporlar** | AUDIT_CLEAN_SWEEP_RAPOR, GHOSTBUSTER_RAPOR, find-zombies.mjs eklendi/güncellendi |

---

## 4. Hata alırsan

- **Push rejected (secret scanning):** Daha önce commit’e giren secret’ları temizle; `git log` ile kontrol et, gerekirse `git rebase -i` veya yeni commit’te secret’ı ekleme.
- **Build failed (Vercel):** Vercel → Deployments → ilgili deployment → **Build Logs** incele; env değişkenleri ve TypeScript hatalarını kontrol et.
- **Canlıda eski görünüm:** Tarayıcıda hard refresh (Ctrl+Shift+R) veya gizli pencere kullan; Vercel’de doğru commit’in deploy edildiğini kontrol et.

Bu adımları kendi terminalinde çalıştırdığında canlıya almış olursun.
