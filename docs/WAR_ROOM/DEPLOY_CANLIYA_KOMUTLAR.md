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

---

## 5. Canlıya alma — Watchtower (bu deploy)

**Tarih:** 2026-01-30  
**Kapsam:** GO W1 (health + request-id), GO W2 (Sentry/GlitchTip), GO W3 (Playwright E2E), hydration fix, auth.json.

### 5.1 Önce kontrol

```bash
cd "c:\Users\serka\OneDrive\Desktop\project\opsmantik-v1"
npm run build
```

- Build hatası yoksa devam et.
- **Canlıda (Vercel) env’de `WATCHTOWER_TEST_THROW` tanımlı OLMAMALI** — yoksa /api/watchtower/test-throw 500 döner.

### 5.2 Vercel’de env (canlı)

| Değişken | Açıklama |
|----------|----------|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry/GlitchTip DSN (canlıda hata izleme için). Vercel → Project → Settings → Environment Variables. |
| `OPSMANTIK_RELEASE` | Opsiyonel. Release tag (örn. commit SHA); Sentry’de gruplama için. Vercel’de otomatik `VERCEL_GIT_COMMIT_SHA` da kullanılabilir. |

`WATCHTOWER_TEST_THROW` **canlıda ekleme**.

### 5.3 Commit ve push

```bash
git add -A
git commit -m "chore: canlıya al - Watchtower GO W1/W2/W3, Sentry, E2E, hydration fix"
git push
```

### 5.4 Push sonrası

- Vercel → Deployments → “Ready” olana kadar bekle.
- Canlıda **health:** `GET https://console.opsmantik.com/api/health` → `ok: true`, header `x-request-id`.
- Sentry/GlitchTip’te canlı projeyi seç; hatalar canlıda da düşsün (DSN doğruysa).
- Gizli pencerede login + dashboard kısa test.
