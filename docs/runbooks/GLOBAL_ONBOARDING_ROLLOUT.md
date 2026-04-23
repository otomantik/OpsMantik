# Global Onboarding Rollout Runbook

## Scope
- Site create flow with locale/country/timezone/currency.
- DB-backed origin registry.
- Super admin control-plane consistency.
- Worker runtime tenant-map fetch.

## Preflight
1. Confirm env vars exist:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `WORKER_TENANT_MAP_TOKEN`
   - `SITE_ORIGIN_VERIFY_TOKEN`
2. Run lint and targeted tests:
   - `npm run lint`
   - `npm run test:unit`
3. Apply migration:
   - `supabase db push`

## Canary Sequence
1. Internal tenant (OpsMantik staging/prod internal site).
2. External pilot #1.
3. External pilot #2.
4. External pilot #3.
5. Global rollout.

## Verify Checklist
1. Create a site from `/dashboard` with all 6 fields.
2. Confirm `site_allowed_origins` rows are auto-created.
3. Confirm `/api/sites/{siteId}/status` works.
4. Confirm `/api/sites/{siteId}/tracker-embed` returns `mode=proxy` by default.
5. Confirm worker can resolve tenant map from `/api/internal/worker/tenant-map`.

## Rollback Switches
- Disable runtime tenant map fetch in worker:
  - unset `SITE_CONFIG_URL` or set it empty.
- Re-enable legacy origin gate:
  - set `ALLOWED_ORIGINS` and fallback path remains active.
- Stop verification requirement:
  - keep `status=active` rows only and skip verify endpoint.

## Incident Playbook
- **Symptom:** 403 on realtime endpoint after new site.
  - Check `site_allowed_origins` row for site.
  - Add missing origin via `/api/sites/{siteId}/origins`.
- **Symptom:** Worker unresolved site.
  - Check tenant-map endpoint auth token.
  - Verify site domain normalization and tenant-map response.
- **Symptom:** Super admin missing controls.
  - Verify `profiles.role='admin'` or metadata role claim.
  - Validate `/api/sites/list` response includes all sites.
