# Canlıya alınacak PR / madde listesi

**Tarih:** 2026-01-30  
**Amaç:** Bu deploy’da canlıya gidecek özellik ve değişikliklerin listesi (PR açıklaması / checklist).

---

## 1. Kapsam (bu deploy’da gidenler)

| # | Alan | Açıklama |
|---|------|----------|
| 1 | **P4-1 Breakdown RPC** | `get_dashboard_breakdown_v1(p_site_id, p_date_from, p_date_to, p_ads_only)` — sources, locations, devices; migration `20260130240000_dashboard_breakdown_v1.sql` |
| 2 | **P4-2 Breakdown UI** | Dashboard’da breakdown widget’lar (Sources, Locations, Devices); shadcn kartlar + progress bar; date range + adsOnly toggle’a bağlı |
| 3 | **P4-3 Recharts** | Source kartında donut, Location kartında yatay bar; list satırları her zaman görünür; ENABLE_CHARTS flag; memoized chart data |
| 4 | **P4-3.1 / P4-3.2 Screenshot** | Stable data-testid (p4-breakdown, p4-source-card, p4-location-card, p4-device-card); auth via storageState (auth-login-save-state.mjs); addCookies kaldırıldı |
| 5 | **Auth / evidence** | `auth-login-save-state.mjs` ile oturum kaydı; p4-ui-screenshot ve p4-3-screenshot storageState kullanıyor |
| 6 | **Deploy komutları** | DEPLOY_CANLIYA_KOMUTLAR.md güncel (sıralı komut + supabase db push) |

---

## 2. Canlıya almadan önce (checklist)

| # | Madde | Komut / kontrol |
|---|--------|------------------|
| 1 | Build geçiyor | `npm run build` |
| 2 | RPC smoke geçiyor | `npm run smoke:p4-breakdown` |
| 3 | UI wiring smoke geçiyor | `npm run smoke:p4-ui` |
| 4 | Migration canlı DB’de | `npx supabase db push` (Supabase projesi bağlı) |
| 5 | Gizli dosya / secret yok | `.env.local` commit’e girmemeli; PROOF_* sadece local |

---

## 3. Canlıya alma komutları (sırayla)

```bash
cd "c:\Users\serka\OneDrive\Desktop\project\opsmantik-v1"
npm run build
npx supabase db push
git add -A
git commit -m "chore: canlıya al - P4 breakdown RPC + UI + Recharts, storageState auth, evidence scripts"
git push
```

Push sonrası: Vercel → Deployments → “Ready” bekle → gizli pencerede canlı URL test.

---

## 4. Canlıda kontrol

| # | Kontrol | Nasıl |
|---|--------|--------|
| 1 | Dashboard açılıyor | `/dashboard/site/<SITE_ID>` (from/to query ile) |
| 2 | Breakdown widget’lar görünüyor | Sources, Locations, Devices kartları + list + (varsa) donut/bar |
| 3 | Tarih / adsOnly değişince veri güncelleniyor | Menüden Day / Scope değiştir |
| 4 | Yatay taşma yok | Mobil görünümde sağa kaydırma olmamalı |

---

## 5. Dosya / PR özeti (değişenler)

- **Backend:** `supabase/migrations/20260130240000_dashboard_breakdown_v1.sql`
- **Hook:** `lib/hooks/use-dashboard-breakdown.ts`
- **UI:** `components/dashboard-v2/widgets/*` (BreakdownWidgets, Source/Location/Device kartları, Donut/Bar chart, charts-config)
- **Shell:** `components/dashboard-v2/DashboardShell.tsx` (BreakdownWidgets entegrasyonu, overflow-x-hidden)
- **Scripts:** `scripts/smoke/auth-login-save-state.mjs`, `p4-ui-screenshot.mjs`, `p4-3-screenshot.mjs`, `p4-breakdown-proof.mjs`, `p4-ui-proof.mjs`
- **Docs:** `docs/WAR_ROOM/REPORTS/P4_BREAKDOWN_RPC_V1.md`, `docs/WAR_ROOM/EVIDENCE/P4_*`, `docs/WAR_ROOM/DEPLOY_CANLIYA_KOMUTLAR.md`
- **Dep:** `package.json` (recharts, smoke:auth-save-state, smoke:p4-ui, smoke:p4-3-screenshot)

Bu listeyi PR açıklamasında veya release notunda kullanabilirsin.
