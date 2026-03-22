# Dead Code Audit (Ölü Kod / Leş Taraması)

**Date:** 2026-03-09  
**Scope:** lib/, app/api, components, scripts, exports.

## Removed (Leşler Kaldırıldı)

| Item | Action |
|------|--------|
| `lib/services/signal-emitter.ts` | **Deleted.** Stub that only threw; no callers. Use `evaluateAndRouteSignal` from `lib/domain/mizan-mantik`. |
| `lib/security/scrub-data.ts` | **Deleted.** `scrubCrossSiteData`, `filterBySiteId`, `validateSiteId`, `SiteScrubbable` had zero imports. |
| `app/api/oci/google-ads-export/route.ts` | Removed unused import `formatGoogleAdsTime` (only `formatGoogleAdsTimeOrNull` is used). |
| `lib/valuation/calculator.ts` | **Deleted.** Entire file; OCI uses `oci-config.computeConversionValue`. |
| `lib/edge-client-ip.ts` | **Deleted.** No code imports; runbook updated to reference `lib/request-client-ip`. |
| `components/dashboard/confidence-score.tsx` | **Deleted.** No imports. |
| `components/dashboard/session-drawer.tsx` | **Deleted.** UI uses LazySessionDrawer only. |
| `lib/billing-metrics.ts` | Removed `resetBillingMetrics`. |
| `lib/utils/format-google-ads-time.ts` | Removed `formatGoogleAdsTime`, `formatGoogleAdsTimeCompact`, `formatGoogleAdsTimeStrict`; kept `formatGoogleAdsTimeOrNull`. |
| `lib/utils/formatting.ts` | Removed `formatTimestampWithTZ`, `getConfidence`, `maskFingerprint`. |
| `lib/domain/mizan-mantik` (barrel) | Removed exports `resolveGearFromLegacy`, `buildFingerprint`. |
| `lib/domain/funnel-kernel` (barrel) | Removed export `computeEstimatedValue`. |
| `lib/entitlements/getEntitlements.ts` | Removed `getEntitlementsForSite`. |
| `lib/utils/ui.ts` | Removed `jumpToSession` and window exposure. |

## Deprecated / Unused Exports (Kalan)

Tüm önceki deprecated öğeler kaldırıldı (yukarıdaki Removed listesine taşındı).

## Scripts / Paths Already Fixed (Previous Pass)

- All references to `docs/_archive` and `docs/archive` in scripts and `.env.local.example` were updated to `tmp/` or `docs/runbooks/` / `docs/evidence/`.
- Diagnostics SQL path: `docs/runbooks/SQL_DIAGNOSTICS.sql` (placeholder created).

## Verified Not Dead

- `lib/billing-metrics` — all increment/get functions used by sync, watchtower, ingest, reconcile, metrics.
- `lib/domain/mizan-mantik/score` — `leadScoreToStar` used by enqueue-seal-conversion, runner.
- `lib/realtime-badge-status` — `getBadgeStatus` used by dashboard-shell.
- `lib/sync-utils` — `getRecentMonths`, `createSyncResponse` used by call-event, sync, attribution-service.
- `lib/conversation/primary-source` — used by process-outbox-events, google-ads-export, ingest, enqueue-seal-conversion, vacuum, etc.
- `lib/oci/ouroboros-watchdog` — used by sweep-zombies and tests.
- `lib/services/rate-limit-service`, `lib/ingest/scoring-engine`, `lib/scoring/call-scores-audit` — in use.

## Unused components (never imported)

Kaldırıldı: `confidence-score.tsx`, `session-drawer.tsx` (yukarıda Removed’da).

## API Routes

- `/api/test-oci`, `/api/sentry-example-api`, `/api/create-test-site` — used by smoke tests or UI; left as dev/demo endpoints.

## CI / Workflows (verified)

- **.github/workflows/smoke.yml** — `scripts/check-no-direct-sessions-access.mjs` exists; `npm run smoke:api` in package.json.
- **.github/workflows/e2e.yml** — `scripts/ci/verify-db.mjs` exists; uploads `ci-reports/db-verify.json` (script writes there).
- **.github/workflows/release-gates.yml** — `npm run release:evidence:pr` / `release:evidence`; script writes `tmp/release-gates-pr.md` and `tmp/release-gates-latest.md`; workflow uploads those paths.
- **.github/workflows/ci.yml** — lint and build only; no script path issues.
- **vercel.json** — crons reference existing `/api/cron/*` routes only.

## Package.json scripts (verified)

- Every `node scripts/...` and `node tests/...` target exists: `verify-rpc-exists.mjs`, `verify-partition-triggers.mjs`, `check-db.js`, `verify-architecture.js`, `create-test-site.js`, `generate-missing-keys.ts`, all `db/*.mjs` and `smoke/*.mjs` referenced, `scripts/release/collect-gate-evidence.mjs`, `scripts/ci/verify-db.mjs`, `scripts/check-no-direct-sessions-access.mjs`, `tests/load/smoke-load.js`, `tests/rls/*.test.ts` (tenant-rls-proof.test.ts).

## Middleware & app (verified)

- **middleware.ts** — uses `updateSession` from `lib/supabase/middleware` only; no dead refs.
- **App pages** — all 9 page.tsx (/, /login, /dashboard, /admin/sites, /test-page, /sentry-example-page, etc.) are valid routes; test-page and sentry-example-page are dev/demo (not linked in nav).

## Deploy / external scripts (verified)

- **deploy/OpsMantik-Quantum-Engine.js** — calls `/api/oci/google-ads-export`, `/api/oci/ack`, `/api/oci/ack-failed`; all routes exist. No dynamic imports of removed modules anywhere in repo.

## i18n

- Use `npm run verify:i18n:keys` and `npm run lint:i18n` to detect missing or unused message keys. No dead-code removal applied to i18n in this audit.
- **Deeper:** `verify:i18n:keys` only checks that keys used in code exist in `en.ts`. **Unused keys (reverse check):** `npm run report:i18n:unused` (or `node scripts/find-unused-i18n-keys.mjs`) reports **75 keys** in `en.ts` with no literal `t('...')` / `translate('...')` in app, components, lib (of 596 total). Categories include: `setup.*`, `seal.*` (labels/aria), `time.*`, `sites.*`, `button.*`, `opsmantik.v*_name`, `confidence.*`, `toast.*`, `adSpend.*`, `admin.sites.*`, etc. Some keys may still be used via `getLocalizedLabel` or dynamic key patterns; review before removing from en/tr/it. No keys were removed in this audit.

## Deeper scan (daha derin)

- **edge-client-ip:** Grep of entire repo (ts, tsx, js, mjs): zero imports. Only mention is `docs/architecture/PRECISION_LOGIC_RUNBOOK.md` as the intended API for future edge/sync integration. Treated as deprecated in code; runbook remains as spec.
- **Env vars:** All `process.env.*` usages are in app, lib, or scripts (smoke, db, cron); `.env.local.example` documents the main ones. No dead env var removal in this audit.
- **Modules re-verified as in use:** `lib/services/telegram-service` (watchtower, test-notification), `lib/services/replay-cache-service` (call-event, gdpr/consent), `lib/api/call-event/schema-drift` (process-call-event), `lib/api/call-event/match-session-by-fingerprint` (call-event routes, tests), `lib/security/scoring` (event-service, intent-flow), `lib/ingest/scoring-engine` (workers/calc-brain-score, tests). No additional dead code found.

## Docs (historical references only)

- Runbooks (e.g. COSMIC_DOSSIER, OCI_LOGIC_BUGS, AZATHOTH, OCI_CHAOS) still mention deleted `pipeline-service` or `conversion-worker` in prose; no code references. Optional: update runbooks to say "formerly pipeline-service" or leave as historical.

## Scripts not in package.json (ad-hoc / one-off)

These scripts exist but are not wired to any `npm run` command. They may be run manually for ops/debug. No change required unless you want to remove or document.

- `scripts/find-zombies.mjs`, `scripts/backfill-traffic-sources.mjs`, `scripts/check-site-id-scope.mjs`, `scripts/check-calls.mjs`, `scripts/check-duplicates.mjs`, `scripts/check-geo-history.mjs`, `scripts/check-today.mjs`, `scripts/check-today-trt.mjs`
- `scripts/analyze-rpc-performance.mjs`, `scripts/verify-rpc-evidence.mjs`, `scripts/verify-ai-pipeline.mjs`, `scripts/run-diagnostics.mjs`, `scripts/run-diagnostics-cli.mjs`
- Many `scripts/db/*.mjs` (oci-muratcan-*, oci-eslamed-*, etc.) and `scripts/smoke/*.mjs` beyond those in package.json
- **scripts/find-unused-i18n-keys.mjs** — lists i18n keys in en.ts never referenced by t()/translate(). Run: `npm run report:i18n:unused`

## Recommendations

1. Run `npm run build` and `npm run test:unit` after any further removals.
2. **Optional:** Run `npm run report:i18n:unused` periodically; review and remove or wire unused keys in en/tr/it (watch for getLocalizedLabel and dynamic keys).
