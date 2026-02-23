# i18n Unification Sprint — Deliverables

## 1) File diff summary

| Change | Description |
|--------|-------------|
| **Deleted** | `lib/i18n/en.ts` (legacy strings module) |
| **Modified** | `lib/i18n/messages/en.ts` — expanded with statusBar, kpi, dashboard, queue, traffic, pulse, health, timeline, date, breakdown, hunter, toast, cro, misc |
| **Modified** | `lib/i18n/messages/tr.ts` — full Turkish translations, UTF-8 (ş, ğ, ı, İ, ö, ü) |
| **Modified** | All dashboard components migrated to `useTranslation()` / `t()` |
| **Added** | `scripts/verify-dashboard-i18n-clean.mjs` — regression guard |
| **Modified** | `package.json` — added `verify:i18n`, wired into `verify` |
| **Modified** | `tests/unit/i18n.test.ts` — locale purity and UTF-8 tests |

## 2) Deleted files

- `lib/i18n/en.ts`

## 3) New message keys (sample)

- statusBar.*, kpi.*, dashboard.*, queue.*, empty.*, button.*, intent.*, seal.*, dimension.*
- traffic.title, traffic.whereVisitorsCameFrom
- pulse.revenueProjection, pulse.basedOnDeals, pulse.conversionPulse, pulse.qualifiedTotal
- health.now, health.minutesAgo, health.hoursAgo, health.healthy, health.degraded, health.critical
- timeline.*, date.*, breakdown.*, hunter.*, toast.*, cro.*, misc.*

Full keys: `lib/i18n/messages/en.ts` and `lib/i18n/messages/tr.ts`.

## 4) Regression guard script

**Path:** `scripts/verify-dashboard-i18n-clean.mjs`

**Checks:**
- No imports from `lib/i18n/en` (legacy strings)
- No `strings.` usage
- No forbidden hardcoded tokens: "Traffic Sources", "Revenue Projection", "Conversion Pulse", "CAPTURE", "OCI ACTIVE", "Intent Qualification Queue"

**Run:** `npm run verify:i18n`

**Exit:** 0 = pass, 1 = fail (with error output)

## 5) Test output

```
# tests 20
# pass 20
# fail 0
```

**New tests:**
- `tr-TR: no known English KPI labels appear`
- `en-US: no Turkish KPI labels (no Turkish chars in KPI/status keys)`
- `tr messages: at least one contains Turkish UTF-8 chars (ş, ğ, ı, İ, ö, ü)`

## 6) Verification steps

1. **Legacy cleanup:**  
   `npm run verify:i18n` — must pass (no legacy imports, no forbidden tokens).

2. **Unit tests:**  
   `node --import tsx --test tests/unit/i18n.test.ts` — all 20 tests must pass.

3. **Full verify:**  
   `npm run verify` — runs RPC, partition-triggers, and i18n checks.

4. **Build:**  
   `npm run build` — must complete successfully (may require full permissions on Windows).

5. **Manual:**  
   - Dashboard with `locale=tr-TR` → 100% Turkish UI  
   - Dashboard with `locale=en-US` → 100% English UI
