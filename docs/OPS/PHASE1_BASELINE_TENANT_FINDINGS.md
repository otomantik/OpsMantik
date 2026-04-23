# Phase 1 Baseline - Tenant Findings

## Snapshot
- Captured at implementation time using `.env.local` linked Supabase project.
- Target tenants:
  - `www.kocotokurtarma.com`
  - `yapiozmendanismanlik.com`
  - `sosreklam.com`

## Findings By Tenant

### `www.kocotokurtarma.com`
- Site exists.
- `sites.locale = tr`, `sites.timezone = UTC` (causes -3h visual lag for Turkey users).
- Runtime compatibility drift detected:
  - `calls.location_source` missing (`42703`) in linked DB.
  - This confirms schema-drift behavior in call insert/select path.

### `yapiozmendanismanlik.com`
- Site not found in linked project.
- Default multi-site smoke fails unless `P0_SITES` is overridden.

### `sosreklam.com`
- Site not found in linked project.
- Default multi-site smoke fails unless `P0_SITES` is overridden.

## Baseline Failure Points
- **Timezone drift:** TR locale tenant on UTC timezone.
- **Geo/click-id schema drift:** call geo/click-id columns not guaranteed in all environments.
- **Smoke gate environment drift:** default gate tenants can be absent in linked project.
- **Admin parity gap (before this patch):**
  - Admin customer click opened dashboard route, not customer panel flow.
  - No server-enforced read-only preview scope.

## Commands Used
- Tenant/site baseline:
  - `node --input-type=module ... supabase-js query for sites`
- Column drift check:
  - `select id, created_at, status, location_source, gclid, click_id from calls ...`

## Result
- Phase 1 baseline now recorded for rollback/forensics and used as input for Phase 2-7 implementation.
