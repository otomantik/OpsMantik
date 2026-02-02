# Teknik Borç Taraması

**Tarih:** 2026-02-02  
**Güncelleme:** 2026-02-02 — Aksiyonlar 1, 2, 3, 5, 6 uygulandı  
**Kapsam:** Kod tabanı (app, components, lib), mevcut CLEANUP_BACKLOG ile birlikte.

---

## 1. Özet

| Kategori | Adet | Öncelik |
|----------|------|---------|
| TODO/TEMP/FIXME | 4 | P2 |
| console.log/warn/error | 125 | P2 (debug olanlar P2) |
| `any` tipi kullanımı | 83 | P2 |
| eslint-disable | 1 | P2 |
| TEMP DEBUG (gated) | 3 dosya | P2 |

---

## 2. TODO / TEMP / FIXME

| Dosya | Satır | İçerik |
|-------|-------|--------|
| `components/dashboard/timeline-chart.tsx` | 104 | `TODO: Install recharts for better chart visualization` |
| `components/dashboard/session-drawer.tsx` | 15 | `TEMP DEBUG (gated, 1 run only)` |
| `components/dashboard/session-group.tsx` | 12 | `TEMP DEBUG (gated, 1 run only)` |
| `lib/hooks/use-visitor-history.ts` | 18 | `TEMP DEBUG (gated, 1 run only)` |

**Öneri:** TEMP DEBUG blokları `shouldLogSessionsErrorsThisRun()` ile kapalı; production'da tetiklenmez. İstersen tamamen kaldır. Timeline TODO: recharts zaten package.json'da; yorum güncellenmeli veya silinmeli.

---

## 3. console.log / warn / error

### Gereksiz / Debug (P2 — kaldırılabilir)

| Dosya | Not |
|-------|-----|
| `app/test-page/page.tsx` | ~15 console.log — test sayfası, dev için; prod'da genelde kullanılmaz |
| `components/dashboard/session-drawer.tsx` | 4× console.log (DEBUG) — gated, yine de temizlenebilir |
| `components/dashboard/session-group.tsx` | 4× console.log (DEBUG) — aynı |
| `lib/hooks/use-visitor-history.ts` | 3× console.log (DEBUG) — aynı |
| `lib/hooks/use-realtime-dashboard.ts` | 6× console.log — Realtime debug; `NEXT_PUBLIC_WARROOM_DEBUG` ile kapatılabilir |
| `lib/auth/isAdmin.ts` | 6× console.log — zaten `isDebug` ile gated |
| `app/auth/callback/route.ts` | 3× console.log — auth flow debug |
| `app/login/page.tsx` | 1× console.log, 1× console.warn |
| `components/dashboard/timeline-chart.tsx` | 2× console.log |
| `components/dashboard/site-setup.tsx` | 3× console.log, 2× console.error |

### Kabul edilebilir (error handling)

- `console.error` — API route'ları, service'ler (CALL_MATCH, SYNC_ERROR, vb.)
- `console.warn` — CORS, SECURITY, UPSTASH uyarıları

**Öneri:** Debug console.log'ları `debugLog()` (lib/utils) veya env-gated wrapper ile değiştir; prod'da kapalı olsun.

---

## 4. `any` Tipi (83 kullanım)

### Yaygın yerler

| Dosya | Kullanım |
|-------|----------|
| `QualificationQueue.tsx` | `rows: any[]`, `raw.map((item: any))`, `(raw as any).data` |
| `HunterCard.tsx` | `icon: any`, `ScanningIcon`, `Quadrant`, `Field` props |
| `use-realtime-dashboard.ts` | `data: any`, `payload: any`, `getMetaField(obj: any)` |
| `session-drawer.tsx` | `metadata: any`, `(sessionError as any)?.message` |
| `session-group.tsx` | `metadata: any`, `(sessionData as any)?.site_id` |
| `event-service.ts` | `geoInfo: any`, `deviceInfo: any`, `meta: any` |
| `session-service.ts` | `geoInfo: any`, `deviceInfo: any`, `session: any` |
| API route'lar | `} catch (e: any)` — yaygın pattern |

**Öneri:**  
- Service'lerde `GeoInfo`, `DeviceInfo` tipleri zaten `lib/geo.ts`'de; import et.  
- Supabase payload'ları için `Database['public']['Tables']['sessions']['Row']` vb. kullan.  
- `catch (e: unknown)` + `e instanceof Error` tercih et.

---

## 5. eslint-disable

| Dosya | Satır | Açıklama |
|-------|-------|----------|
| `components/dashboard/timeline-chart.tsx` | 100 | `eslint-disable-next-line react-hooks/exhaustive-deps` |

**Öneri:** Dependency array eksikliği varsa nedenini not et veya `useCallback`/`useMemo` ile düzelt; mümkünse disable kaldır.

---

## 6. Mevcut CLEANUP_BACKLOG ile Örtüşenler

- **P0:** Partition drift, orphan calls/events — `CLEANUP_QUICK_AUDIT.sql` ile izle.
- **P1:** RPC payload growth, realtime source-of-truth, çoklu polling, v1/v2 coexistence.
- **P2:** Dead grant code, half-open vs BETWEEN, TRT vs UTC scripts, hook deps, suppressHydrationWarning.

---

## 7. Öncelikli Aksiyonlar

| # | Aksiyon | Öncelik | Durum |
|---|---------|---------|-------|
| 1 | TEMP DEBUG bloklarını kaldır veya `debugLog()` ile değiştir | P2 | ✅ Yapıldı |
| 2 | `timeline-chart.tsx` TODO yorumunu güncelle/sil (recharts zaten var) | P2 | ✅ Yapıldı |
| 3 | `event-service`, `session-service`: `any` → `GeoInfo`, `DeviceInfo` | P2 | ✅ Yapıldı |
| 4 | `catch (e: any)` → `catch (e: unknown)` + type guard | P2 | ✅ Yapıldı |
| 5 | Test sayfası console.log'ları: dev-only wrapper veya kaldır | P2 | ✅ Yapıldı (debugLog) |
| 6 | Realtime dashboard console.log: `NEXT_PUBLIC_WARROOM_DEBUG` gated | P2 | ✅ Yapıldı (debugLog) |

---

## 8. Dosya Başına Özet

| Dosya | console | any | TODO/TEMP |
|-------|---------|-----|-----------|
| session-drawer.tsx | 4 debug | 4 | TEMP DEBUG |
| session-group.tsx | 5 | 6 | TEMP DEBUG |
| use-visitor-history.ts | 3 debug | 3 | TEMP DEBUG |
| use-realtime-dashboard.ts | 6 | 14 | — |
| isAdmin.ts | 6 (gated) | 0 | — |
| QualificationQueue.tsx | 0 | 6 | — |
| HunterCard.tsx | 0 | 5 | — |
| event-service.ts | 1 | 4 | — |
| session-service.ts | 2 | 5 | — |
