# Teknik Borç Taraması

**Tarih:** 2026-02-02  
**Güncelleme:** 2026-02-02 — Mühendis modu tam tarama  
**Kapsam:** Kod tabanı (app, components, lib, supabase), CLEANUP_BACKLOG ile birlikte.

---

## 1. Özet

| Kategori | Adet | Öncelik |
|----------|------|---------|
| TODO/FIXME/HACK | 0 | — |
| console.log/warn/error | 95 | P2 (debug olanlar) |
| `any` tipi | 60 | P2 |
| eslint-disable | 1 | P2 |
| catch (e: any) | 0 | ✅ Tamamlandı |
| @ts-ignore | 0 | — |

---

## 2. console.log / warn / error (95 adet)

### Kabul edilebilir (error handling, güvenlik, prod)

| Dosya | Not |
|-------|-----|
| API route'lar | `console.error` — SYNC_API, CALL_MATCH, SITES_*, CUSTOMERS_INVITE, CREATE_TEST_SITE, STATS_REALTIME |
| lib/services | `console.error` — session-service, event-service, site-service |
| lib/security | `console.warn/error` — validate-site-access, scrub-data |
| lib/cors.ts | `console.error/warn` — ALLOWED_ORIGINS, wildcard uyarısı |
| lib/utils.ts | `console.warn` — jumpToSession, formatTimestamp |
| lib/upstash.ts | `console.warn` — Redis credentials missing |
| Supabase functions | hunter-ai, maintain-db — edge logging |

### Debug / dev-only (P2 → debugLog)

| Dosya | Satır | İçerik |
|-------|-------|--------|
| `components/dashboard/timeline-chart.tsx` | 64, 89 | Refreshing chart, Auto-refresh interval |
| `components/dashboard/site-setup.tsx` | 33, 37, 38 | Test site created, public_id, Use in test page |
| `components/dashboard/session-group.tsx` | 143 | Call lookup error (RLS?) |
| `app/auth/callback/route.ts` | 83, 84, 85 | Session exchanged, Cookies set, Redirecting |
| `app/login/page.tsx` | 45, 50 | NEXT_PUBLIC_PRIMARY_DOMAIN fallback, redirectTo |
| `lib/auth/isAdmin.ts` | 26, 33, 39, 51, 59, 67 | getUser error, No user, Checking admin, Profile query/not found, User role — zaten `isDebug` ile gated |

---

## 3. `any` Tipi (60 adet)

### Kritik hotspotlar

| Dosya | Kullanım |
|-------|----------|
| `use-realtime-dashboard.ts` | `DashboardEvent` types (call_created/updated, event_created), `getMetaField(obj: any)`, `decideAdsFromPayload(payload: any)`, `payload.new as any` |
| `QualificationQueue.tsx` | `rows: any[]`, `raw.map((item: any))`, `(raw as any).data`, `fetchError: any` |
| `session-group.tsx` | `metadata: any`, `matchedCall: any`, `sessionRows[0] as any`, `(sessionData as any)?.site_id` |
| `HunterCard.tsx` | `icon: any`, `ScanningIcon`, `Quadrant`, `Field` — props any |
| `session-drawer.tsx` | `metadata: any`, `(sessionError as any)?.message` |
| `lazy-session-drawer.tsx` | `metadata: any`, `(tData as any[])` |

### API / lib

| Dosya | Kullanım |
|-------|----------|
| `app/api/oci/export/route.ts` | `(site as any)?.currency`, `rows.map((r: any))`, `sessions as any[]` |
| `app/api/call-event/route.ts` | `scoreBreakdown: any`, `(e.metadata as any)?.lead_score` |
| `app/api/sync/worker/route.ts` | `rawBody: any`, `err as any`, `(error as any)?.message` |
| `app/api/intents/[id]/status/route.ts` | `(call.sites as any)?.user_id`, `updateData: any` |
| `lib/geo.ts` | `meta?: any` |
| `lib/supabase/middleware.ts` | `options?: any` |
| `lib/supabase/admin.ts` | `(client as any)[prop]` |

**Öneri:** Supabase `Database['public']['Tables']` tipleri kullan; event payload için `RealtimePostgresChangesPayload`; UI bileşenleri için explicit interface.

---

## 4. eslint-disable

| Dosya | Satır | Açıklama |
|-------|-------|----------|
| `timeline-chart.tsx` | 100 | `react-hooks/exhaustive-deps` — effectiveInterval tek dep; açıklama eklendi |

---

## 5. CLEANUP_BACKLOG ile Örtüşenler

| Öncelik | Madde | Durum |
|---------|-------|-------|
| P0 | Partition drift, orphan calls/events | `CLEANUP_QUICK_AUDIT.sql` ile izleniyor |
| P1 | RPC payload growth, realtime source-of-truth | Dokümante |
| P1 | Çoklu polling (500ms + 10s + 5min fallback) | Opsiyonel konsolidasyon |
| P1 | v1 vs v2 RPC coexistence | Opsiyonel v1 deprecation |
| P2 | Dead grant `get_dashboard_stats(uuid,int)` | Migration güncellemesi |
| P2 | Hook dependency arrays | Audit önerilir |
| P2 | suppressHydrationWarning | Yeni zaman alanları için pattern |

---

## 6. Tamamlanan Aksiyonlar

| # | Aksiyon | Durum |
|---|---------|-------|
| 1 | TEMP DEBUG → debugLog | ✅ |
| 2 | timeline-chart TODO | ✅ |
| 3 | event-service, session-service GeoInfo/DeviceInfo | ✅ |
| 4 | catch (e: any) → catch (e: unknown) | ✅ |
| 5 | Test page console.log → debugLog | ✅ |
| 6 | Realtime dashboard console.log → debugLog | ✅ |

---

## 7. Bekleyen / Önerilen Aksiyonlar

| # | Aksiyon | Öncelik |
|---|---------|---------|
| 1 | timeline-chart, site-setup, session-group, auth callback, login: debug log'ları → debugLog | P2 ✅ |
| 2 | QualificationQueue: rows/raw tipleri → IntentRow[] veya DB tipi | P2 |
| 3 | use-realtime-dashboard: DashboardEvent data tipleri → Call/Event interface | P2 |
| 4 | HunterCard: ScanningIcon, Quadrant, Field props interface | P2 |
| 5 | sync/worker rawBody, OCI export, call-event: any → explicit types | P2 |

---

## 8. Dosya Başına Özet

| Dosya | console (debug) | any |
|-------|-----------------|-----|
| use-realtime-dashboard.ts | — | 14 |
| QualificationQueue.tsx | — | 8 |
| session-group.tsx | 1 | 5 |
| HunterCard.tsx | — | 5 |
| session-drawer.tsx | — | 3 |
| oci/export/route.ts | — | 4 |
| sync/worker/route.ts | — | 3 |
| call-event/route.ts | — | 2 |
| timeline-chart.tsx | 2 | — |
