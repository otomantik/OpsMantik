# ADR 004: Global-neutral defaults, SSOT consolidation, and real-time outbox

- **Status:** Accepted
- **Date:** 2026-04-19
- **Context:** OpsMantik shipped as a Turkey-first product. Turkish geography
  was encoded into the runtime in places that were invisible until we tried
  to onboard the first non-TR customer: `'TRY'` and `'Europe/Istanbul'`
  fallbacks sprinkled across the OCI export pipeline, a `isTurkishSite`
  branch in the signal orchestrator, `formatTimestamp` hardcoded to TRT,
  three redundant identity-hash call sites, an `ingest_fallback_buffer`
  layer nobody used, god-object route files approaching 1300 lines, a
  2-minute outbox cron that left seal→export latency visible to users, an
  insecure `VOID_LEDGER_SALT` fallback, and a runbook set bloated with
  per-site forensic dumps (55+ files).

  The Phase 4–5 refactor had to prepare the codebase for global launch
  without breaking Turkish customers mid-flight.

- **Decision:**
  1. **Neutral defaults everywhere.** Runtime fallbacks shifted from
     `TRY`/`Europe/Istanbul`/`TR` to `USD`/`UTC`/`US`. Per-site values are
     the only source of truth. DB CHECK constraints
     (`sites_currency_iso4217_chk`, `sites_timezone_iana_chk`,
     `sites_default_country_iso_chk`) enforce the ISO-4217/IANA/ISO-3166-1
     shape at the tenancy boundary.
  2. **SSOT helpers for every cross-cutting concern.** We collapsed parallel
     implementations into single canonical modules:
     - `lib/i18n/site-locale.ts` for currency/timezone resolution
     - `lib/dic/phone-hash.ts` (+ `hashE164ForEnhancedConversions`,
       `resolvePhoneHashSalt`) for identity hashing
     - `lib/oci/marketing-signal-hash.ts` + `getVoidLedgerSalt` for the
       Merkle chain
     - `lib/oci/outbox/process-outbox.ts` for outbox processing (shared
       between the cron backup and the new QStash worker)
     - `components/context/site-locale-context.tsx` +
       `lib/utils/formatting.ts#formatTimestampInZone` for UI time display
     - `lib/admin/metrics.ts` for observability snapshots
     Each SSOT has an architecture test that pins unique ownership so
     future PRs cannot silently re-introduce parallel paths.
  3. **Fail-fast over silent fallback on critical secrets.**
     `VOID_LEDGER_SALT` now throws at boot in production if missing (was a
     silent `'void_consensus_salt_insecure'` literal). `OCI_PHONE_HASH_SALT`
     stays configurable but routed through the SSOT and warned on every
     seal when empty in production.
  4. **Real-time outbox trigger + cron as safety net.** Seal/stage routes
     publish a QStash message to `/api/workers/oci/process-outbox`
     immediately after `apply_call_action_v1` writes the PENDING row. The
     cron at `/api/cron/oci/process-outbox-events` stays scheduled every
     5 minutes as a backup for dropped publishes — its schedule was slowed
     from `*/2` now that the hot path is real-time. Dedup key buckets
     rapid retries into 10-second windows so QStash absorbs bursts.
  5. **God-object decomposition without behaviour change.** `runner.ts`
     and `google-ads-export/route.ts` each shed ~200 lines into typed
     submodules under `lib/oci/runner/*` and
     `lib/oci/google-ads-export/*`. Architecture tests enforce line-budget
     ceilings so the files cannot re-bloat.
  6. **Docs pruned for the on-call.** 48 per-site forensic notes and
     one-shot audit dossiers were deleted; the runbook set was reduced to
     the 16 active procedures. `docs/GLOBAL_LAUNCH_CHECKLIST.md` replaces
     the scattered deploy checklists as the single pre-cutover gate.

- **Consequences:**
  - **Positive**
    - Non-TR customers can be onboarded without code changes — just populate
      `sites.currency` / `timezone` / `default_country_iso` / `locale`.
    - Merkle ledger + phone hashes byte-identical across seal, stage,
      export, and runner — Enhanced Conversions no longer double-count.
    - Seal→export latency dropped from up to 2 minutes (cron window) to
      ~seconds (QStash).
    - Tests grew from 39 to 192 with 100% pass rate; every SSOT, CHECK
      constraint, and behavioural invariant is now pinned.
    - On-call docs are small enough to read end-to-end before an
      incident. Pruned files are locked deleted by a scanner test.
    - Observability: `/api/admin/metrics` exposes dispatch PENDING,
      success rate, DLQ depth with Sentry tags authored directly from the
      snapshot shape.
  - **Negative / to migrate later**
    - Legacy `formatTimestamp` default (Europe/Istanbul) and
      `DEFAULT_TIMEZONE` in `lib/time/today-range.ts` were intentionally
      *not* flipped to UTC because many dashboard call sites do not yet
      thread the site timezone through. Those call sites should be
      migrated piecewise to `formatTimestampInZone` + `useSiteTimezone()`
      until the hardcoded Istanbul default becomes unreachable, at which
      point we flip the default.
    - `outbox_events` + `offline_conversion_queue` → `conversion_dispatch`
      unified-table merge is explicitly deferred (see
      `f4-conversion-dispatch-merge`). The schemas stay separate today;
      the merge needs its own dedicated PR with staged migrations.
    - `marketing_signals.dispatch_status` counters in `admin_metrics`
      assume the column exists in every environment. A preview branch
      without the migration will report 0s — acceptable, documented.
  - **Risk surface**
    - `VOID_LEDGER_SALT` must be set in production before deploy.
      `.env.local.example` documents this; boot throws if unset.
    - DB CHECK constraints on `sites.*` reject historical junk values.
      The migrations backfill before adding the CHECK so no existing rows
      can violate, but any external tooling that writes to `sites` must
      now use valid ISO codes.

- **Links:**
  - `docs/GLOBAL_LAUNCH_CHECKLIST.md` — pre-cutover gate
  - `docs/architecture/OCI_VALUE_ENGINES_SSOT.md` — canonical value math
  - `supabase/migrations/20260419170000_drop_bitemporal_marketing_signals.sql`
  - `supabase/migrations/20260419180000_drop_ingest_fallback_buffer.sql`
  - `supabase/migrations/20260419200000_sites_locale_strict_check.sql`
  - `supabase/migrations/20260419210000_sites_country_iso_strict_check.sql`
  - `tests/architecture/phase4-*.test.ts`, `tests/architecture/phase5-*.test.ts`
