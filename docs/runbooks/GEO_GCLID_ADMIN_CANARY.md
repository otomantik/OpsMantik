# Geo + GCLID + Admin Preview Canary Runbook

## Goal
Roll out deterministic geo policy and admin->customer panel preview safely with tenant boundaries preserved.

## Preflight
- `node scripts/ci/verify-db.mjs`
- `npm run smoke:intent-worker-deps`
- `npm run smoke:geo-gclid-policy`
- `P0_SITES=www.kocotokurtarma.com npm run smoke:intent-multi-site`

## Canary Sequence
1. **Single tenant canary** (`www.kocotokurtarma.com`)
   - Verify panel clock and card timestamps are TRT-correct for locale `tr`.
   - Verify phone button creates intent card.
   - Verify `location_reason_code` and `location_confidence` populated (if columns exist).
2. **Admin preview canary**
   - From admin site list, open tenant via `/api/admin/panel-preview?siteId=...`.
   - Confirm panel opens with `read-only preview` badge.
   - Attempt stage mutation, confirm API returns `READ_ONLY_SCOPE` (403).
3. **Multi-tenant expansion**
   - Add next tenants to `P0_SITES`.
   - Re-run smoke gate and compare intent visibility latency.

## Required Observability
- `CLICK_ID_DROPPED_INVALID_CLICK_ID`
- `CLICK_ID_SCHEMA_DRIFT_STRIP`
- `WORKERS_INGEST_GATE_REJECT`
- `SESSION_GEO_UPSERT_FAILED`
- `SESSION_GEO_UPSERT_AFTER_CREATE_FAILED`

## Rollback
- **App rollback:** revert latest deployment.
- **DB rollback:** keep additive geo columns (safe), no destructive rollback needed.
- **Traffic fallback:** if preview route breaks, admin can still open `/panel` directly.

## Success Criteria
- No repeat of Helsinki/Frankfurt ghost city for no-click-id traffic.
- Click-id present flows keep ads geo lock (`gclid_attribution_locked`).
- Admin preview always tenant-scoped and read-only enforced server-side.
- Intent pipeline remains green (`sync -> processed_signals/events/calls -> panel`).
