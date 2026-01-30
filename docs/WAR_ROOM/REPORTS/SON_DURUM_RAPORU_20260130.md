# Son durum raporu

**Tarih:** 2026-01-30  
**Kapsam:** P4 Breakdown (RPC + UI + Recharts), evidence script’ler, canlıya hazırlık.

---

## 1. Genel durum

| Alan | Durum | Not |
|------|--------|-----|
| **P4-1 Breakdown RPC** | ✅ Tamamlandı | `get_dashboard_breakdown_v1`; migration `20260130240000` |
| **P4-2 Breakdown UI** | ✅ Tamamlandı | Widget’lar DashboardShell’de; list + progress bar; date/adsOnly bağlı |
| **P4-3 Recharts** | ✅ Tamamlandı | Donut (Source), bar (Location); fixed height; memoized; ENABLE_CHARTS |
| **P4-3.1 / 3.2 Screenshot** | ✅ Tamamlandı | data-testid’ler; auth via storageState; NOTE.txt fallback’te |
| **Auth / evidence** | ✅ Tamamlandı | auth-login-save-state.mjs; p4-ui / p4-3 screenshot storageState kullanıyor |
| **Build** | ⚠️ Yerelde kontrol | `npm run build` compile geçiyor; bazı ortamlarda TypeScript adımında EPERM görülebilir |
| **Canlıya hazırlık** | 📋 Liste hazır | CANLIYA_ALINACAK_PRMT_LISTESI.md + DEPLOY_CANLIYA_KOMUTLAR.md güncel |

---

## 2. Evidence durumu

| Script / çıktı | Beklenen | Mevcut (örnek) |
|----------------|----------|-----------------|
| p4-breakdown-proof | PASS, rpc_result_v1.json | PASS (smoke_log: total=0 veya dolu) |
| p4-ui-proof | PASS (wiring) | PASS |
| auth-login-save-state | auth-state.json | auth-state.json veya login-fail.png (fail ise) |
| p4-ui-screenshot | P4_2_UI/widgets.png | widgets.png mevcut |
| p4-3-screenshot | P4_3_CHARTS/source-donut.png, location-bars.png | Başarıda donut+bars; fallback’te source-card.png, location-card.png, full.png, NOTE.txt |

**Not:** P4_3_CHARTS’ta son çalıştırmada fallback (full.png, debug-html-snippet.txt) görülüyorsa, app çalışırken önce `auth-login-save-state.mjs`, sonra `p4-3-screenshot.mjs` tekrar çalıştırılmalı; breakdown verisi olan site + tarih aralığı kullanılmalı.

---

## 3. Canlıya alım özeti

**Yapılacaklar (sırayla):**

1. `npm run build` — geçmeli  
2. `npm run smoke:p4-breakdown` — (isteğe bağlı) PASS  
3. `npm run smoke:p4-ui` — (isteğe bağlı) PASS  
4. `npx supabase db push` — migration canlı DB’de  
5. `git add -A` → `git commit -m "chore: canlıya al - ..."` → `git push`  
6. Vercel’de “Ready” bekle → gizli pencerede canlı test  

**Detay:** `docs/WAR_ROOM/DEPLOY_CANLIYA_KOMUTLAR.md`  
**PR / madde listesi:** `docs/WAR_ROOM/CANLIYA_ALINACAK_PRMT_LISTESI.md`

---

## 4. Açık / dikkat maddeleri

| # | Madde | Öneri |
|---|--------|--------|
| 1 | P4_3_CHARTS’ta source-donut.png / location-bars.png yoksa | App + auth state ile p4-3-screenshot tekrar çalıştır; breakdown verisi olan site kullan |
| 2 | auth-state.json süresi | Session biterse auth-login-save-state.mjs yeniden çalıştır |
| 3 | .env.local | Commit’e eklenmemeli; PROOF_* sadece local evidence için |

---

## 5. Özet

- **P4 Breakdown (RPC + UI + Recharts)** tamamlandı; list satırları her zaman görünür, chart’lar ek (donut + bar).  
- **Evidence:** storageState ile auth; p4-ui ve p4-3 screenshot script’leri güncel; fallback’te NOTE.txt yazılıyor.  
- **Canlıya:** Build + (isteğe bağlı) smoke + `supabase db push` + commit/push; DEPLOY_CANLIYA_KOMUTLAR ve CANLIYA_ALINACAK_PRMT_LISTESI güncel.

Bu doküman anlık durumu özetler; evidence ve build çıktıları yerel/CI’a göre değişebilir.
