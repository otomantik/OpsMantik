## OpsMantik Cleanup — Quick Audit (P0)

This audit is designed to catch **P0 correctness** regressions early:
- Partition/month-key drift (`created_month`, `session_month`)
- Orphan rows across `calls/sessions/events`
- Ads-only gating sanity (`is_ads_session`)
- UTM keyword capture coverage (GCLID sessions)
- OCI pipeline health
- RPC health smoke

### How to run
1. Open Supabase SQL Editor (production or staging).
2. Paste and run `docs/AUDIT/CLEANUP_QUICK_AUDIT.sql`.
3. Save the output for each query (copy/paste back into the audit thread).

### Findings log (paste results here)
- **A) bad_sessions_partition_key:** (not reported; assume 0)
- **A) bad_events_partition_key:** **47** → fixed with `20260202030000_fix_events_partition_drift_only.sql`; verified **0**
- **B) Orphans:** (not reported)
- **C) Ads (30d):** ads_sessions 1917, total 2563, ads_rate **74.8%** — OK
- **D) UTM (30d):** gclid_sessions 1869, with_utm_term 614, utm_term_coverage **32.9%** — depends on tracking template
- **E) OCI pipeline health (30d):** `(null)` 350, sealed 15, skipped 5 → intentional until panel rollout. “OCI pipeline health” 
### Expected results (high-level)
- **bad_sessions_partition_key** = 0
- **bad_events_partition_key** = 0
- **calls_with_missing_session** = 0
- **events_with_missing_session** = 0
- **ads_rate_pct_30d**: depends on site mix, but should not be 0% for paid-search heavy sites
- **utm_term_coverage_pct_30d**: should be non-trivial only if tracking template includes `utm_term={keyword}`
- OCI `failed`: should be near 0; investigate spikes

### OCI pipeline health (section E) — how to read results
- **oci_status** is set only when:
  - User seals a call (Seal API) or confirms/skips in Qualification → `sealed` or `skipped`
  - OCI export marks rows after upload → `uploaded` or `failed`
- **High `(null)` count** = calls that never went through Seal or Qualification (e.g. created before OCI fields existed, or from a flow that doesn’t set status). Not necessarily a bug; decide if you want a backfill or to treat null as “pending”.

### If something is red (non-zero)
- Do **not** jump to UI changes. First, fix correctness:
  - Partition drift → follow `DATABASE_CLEANUP_PLAN.md`
  - Orphans → check call/session matching logic + FK/trigger drift
  - Ads rate near 0% → check tracker payload + URL template
  - RPC errors → check function definition drift (latest migration) and grants

