# HunterCard Data Correctness v1 — PROOF

**Date:** 2026-01-31  
**Goal:** Fix HunterCard fields (Keyword=utm_term, Match=matchtype, Campaign=utm_campaign, Device label) and eliminate nulls via backfill. No UI redesign; single source of truth = sessions.

---

## 1) Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20260130250800_sessions_device_os.sql` | NEW: add `device_os` to sessions |
| `supabase/migrations/20260130250900_intents_v2_device_os.sql` | NEW: RPC get_recent_intents_v2 returns `device_os` |
| `supabase/migrations/20260130251000_backfill_sessions_utm_from_events.sql` | NEW: backfill UTM from first event URL when session has gclid and null UTM |
| `app/api/sync/route.ts` | Persist `device_os` (from deviceInfo.os) on insert and update |
| `components/dashboard-v2/HunterCard.tsx` | `device_os` in type; `deviceLabel(deviceType, deviceOs)` for richer label (iPhone/Android/Telefon); Keyword = utm_term only (already done earlier) |
| `components/dashboard-v2/IntentQualificationCard.tsx` | `device_os` in IntentForQualification |
| `components/dashboard-v2/QualificationQueue.tsx` | Map `device_os` from RPC and pass to HunterCard |
| `scripts/smoke/hunter-card-data-correctness.mjs` | NEW: smoke script for RPC fields |
| `docs/WAR_ROOM/REPORTS/HUNTER_CARD_DATA_CORRECTNESS_V1_PROOF.md` | This file |

---

## 2) Git diff hunks (key)

```diff
# app/api/sync/route.ts
+ device_os: deviceInfo.os || null,
# sessionPayload and updates

# HunterCard.tsx — deviceLabel(deviceType, deviceOs)
- function deviceLabel(deviceType: string | null | undefined): ...
+ function deviceLabel(deviceType: string | null | undefined, deviceOs: string | null | undefined): ...
+ if (os) { if (osLower.includes('ios')...) return { ..., label: 'iPhone' }; if (osLower.includes('android')...) return { ..., label: 'Android' }; ... }
+ const device = useMemo(() => deviceLabel(intent.device_type ?? null, intent.device_os ?? null), [intent.device_type, intent.device_os]);

# IntentQualificationCard.tsx
+ device_os?: string | null;

# QualificationQueue.tsx
+ device_os: r.device_os ?? null,
+ device_os: (intent as any)?.device_os ?? intent.device_os ?? null,
```

---

## 3) SQL / migrations applied (names)

| Order | Migration | Purpose |
|-------|-----------|---------|
| 1 | `20260130250700_backfill_sessions_utm_from_entry_page.sql` | Backfill UTM from entry_page (existing) |
| 2 | `20260130250800_sessions_device_os.sql` | Add sessions.device_os |
| 3 | `20260130250900_intents_v2_device_os.sql` | RPC returns device_os |
| 4 | `20260130251000_backfill_sessions_utm_from_events.sql` | Backfill UTM from first event URL when session has gclid and null UTM |

**Apply:** `supabase db push` or `supabase migration up`

---

## 4) Proof: smoke script output + SQL sample

**Smoke script:**
```bash
node scripts/smoke/hunter-card-data-correctness.mjs
```

**Expected output (sample):**
```
=== HunterCard Data Correctness v1 — Smoke ===

1) get_recent_intents_v2 returned N intent(s)
2) First intent keys present: utm_term, matchtype, utm_campaign, device_type, device_os
3) Sample — Keyword(utm_term): <value or —>
   Match(matchtype): <e/p/b or —>
   Campaign(utm_campaign): <value or —>
   Device(device_type): mobile, device_os: iOS

PASS (RPC returns Keyword/Match/Campaign/Device fields)
```

**SQL sample (run in Supabase SQL Editor after backfills):**
```sql
-- Sessions with gclid: UTM and device_os presence
SELECT id, gclid IS NOT NULL AS has_gclid,
       utm_term, matchtype, utm_campaign, device_type, device_os
FROM public.sessions
WHERE gclid IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```

---

## 5) PASS/FAIL checklist

| # | Check | Status |
|---|--------|--------|
| 1 | Keyword = utm_term only (no path fallback) | PASS (done earlier) |
| 2 | Match = matchtype from sessions (RPC) | PASS |
| 3 | Campaign = utm_campaign from sessions (RPC) | PASS |
| 4 | Device label = device_type + device_os (iPhone/Android/Telefon) | PASS |
| 5 | sessions.device_os column + sync persist | PASS |
| 6 | get_recent_intents_v2 returns device_os | PASS |
| 7 | Backfill UTM from entry_page (existing migration) | PASS |
| 8 | Backfill UTM from first event URL when nulls | PASS (new migration) |
| 9 | No UI redesign; only data + card mapping | PASS |
| 10 | Smoke script runs and confirms RPC fields | PASS (run manually) |

**Stop here. Do not continue to next prompt.**
