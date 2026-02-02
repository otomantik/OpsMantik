# GO3 – Today/Yesterday Selection → QualificationQueue Fetch – AUTOPROOF Checklist

**Scope:** DashboardShell (selectedDay) + QualificationQueue (range → get_recent_intents_v2)  
**Date:** 2025-01-29

---

## Implementation Summary (already wired)

1. **selectedDay state** in `DashboardShell` (single source of truth): `'today' | 'yesterday'`.

2. **Date range (UTC, Europe/Istanbul TRT boundaries):**
   - **Today:** `date_from` = today 00:00 TRT (UTC), `date_to` = now (UTC).
   - **Yesterday:** `date_from` = yesterday 00:00 TRT (UTC), `date_to` = yesterday 23:59:59.999 TRT (UTC).
   - Computed in `queueRange` via `getTodayTrtUtcRange` and one-day offset.

3. **Passed to QualificationQueue:** `range={{ day, fromIso, toIso }}` (same as date_from/date_to).

4. **Queue fetch:** `get_recent_intents_v2(p_site_id, p_date_from: range.fromIso, p_date_to: range.toIso, p_limit, p_ads_only)`; fallback to `get_recent_intents_v1` if v2 unavailable.

5. **Visible change on toggle:** Queue refetches when `range` changes (dependency in `fetchUnscoredIntents`). Empty state for yesterday: "No data for yesterday" / "No intents were found for yesterday in the selected TRT window."

---

## AUTOPROOF Steps

| Step | Command / Action | Expected |
|------|------------------|----------|
| 1 | `npm run build` | Compiles successfully. |
| 2 | `node scripts/smoke/go3-queue-counts-today-yesterday.mjs` | Prints today vs yesterday pending counts (TRT ranges). |
| 3 | `node scripts/smoke/ui-go3-today-yesterday.mjs` | Exit 0; initial data-day=today; after toggle data-day=yesterday; range params change; screenshots under PHASE4_GO3_DAY_TOGGLE. |
| 4 | Screenshots | `queue-today.png`, `queue-yesterday.png`. |

---

## Playwright Script: `scripts/smoke/ui-go3-today-yesterday.mjs`

- Loads dashboard; waits for `[data-testid="queue-range"]`.
- Asserts initial `data-day=today` and `data-from` / `data-to` present.
- Screenshot: `queue-today.png`.
- Opens overflow menu, clicks "Yesterday".
- Waits for `data-day=yesterday`.
- Asserts `data-from` / `data-to` differ from Today (network/range params change).
- Asserts UI updated (empty state or queue content).
- Screenshot: `queue-yesterday.png`.

---

## SQL Proof Script: `scripts/smoke/go3-queue-counts-today-yesterday.mjs`

- Uses same TRT range logic as DashboardShell (today 00:00 TRT → now; yesterday 00:00 TRT → yesterday 23:59:59.999 TRT).
- Calls `get_recent_intents_v2` for today and yesterday ranges.
- Prints pending counts (and total in range) for each.
- Requires `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional `PROOF_SITE_ID`.

---

## PASS/FAIL Checklist (fill after run)

| Item | Status |
|------|--------|
| `npm run build` | ☐ PASS / ☐ FAIL |
| selectedDay state in DashboardShell | ☐ PASS / ☐ FAIL |
| queueRange TRT boundaries (today / yesterday) | ☐ PASS / ☐ FAIL |
| QualificationQueue receives range, uses in RPC | ☐ PASS / ☐ FAIL |
| get_recent_intents_v2 called with date_from/date_to | ☐ PASS / ☐ FAIL |
| Queue visibly changes on Today→Yesterday toggle | ☐ PASS / ☐ FAIL |
| Clear empty state for yesterday | ☐ PASS / ☐ FAIL |
| go3-queue-counts-today-yesterday.mjs prints counts | ☐ PASS / ☐ FAIL |
| ui-go3-today-yesterday.mjs exit 0, screenshots saved | ☐ PASS / ☐ FAIL |

---

*GO3 – Today/Yesterday selection wired to QualificationQueue fetch.*
