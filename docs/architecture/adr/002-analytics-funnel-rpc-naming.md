# ADR 002: Analytics funnel RPC naming

- **Status:** Accepted
- **Date:** 2026-03-22
- **Context:** The Supabase RPC `analyze_gumus_alanlar_funnel` predates neutral naming. Renaming in place risks drift between environments if migration order differs.
- **Decision:**
  - Application code calls **`analyze_gumus_alanlar_funnel`** only via [`AnalyticsService.getFunnelAnalysis`](../../../lib/services/analytics-service.ts) (single choke point).
  - A DBA **may** add `analyze_site_funnel` as a SQL alias in production after verifying return columns match [`FunnelMetrics`](../../../lib/services/analytics-service.ts); optional script: [`scripts/sql/create_analyze_site_funnel_alias.sql`](../../../scripts/sql/create_analyze_site_funnel_alias.sql).
  - `npm run verify` does not require the alias until the app switches RPC name.
- **Consequences:** Neutral naming in DB is optional; no forced migration in CI. When alias exists and is verified, update `AnalyticsService` to call `analyze_site_funnel` and add the RPC to `scripts/verify-rpc-exists.mjs` optional list.
- **Links:** [MODULE_BOUNDARIES.md](../MODULE_BOUNDARIES.md)
