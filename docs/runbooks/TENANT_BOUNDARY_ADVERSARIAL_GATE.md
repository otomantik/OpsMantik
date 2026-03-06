# Tenant Boundary Adversarial Gate

## Purpose

This runbook defines the focused gate for cross-site mutation safety in the conversation layer.

The gate is intended to prove that tenant-boundary protections fail closed at the database layer, even if an application route regresses.

## Covered Surfaces

- `conversations` create rejects foreign-site primary `call`
- `conversations` create rejects foreign-site primary `session`
- `conversation_links` insert rejects foreign-site `call`, `session`, and `event`
- `conversation_links` update rejects foreign-site rebinding and preserves the existing link
- `sales` insert rejects foreign-site `conversation_id`
- `sales` update rejects foreign-site `conversation_id` rebinding and preserves the existing row
- `sessions` refuse foreign-site `client_sid` reuse and generate a tenant-safe replacement session instead of mutating another tenant

## Command

```bash
npm run test:tenant-boundary
```

## Preconditions

- `NEXT_PUBLIC_SUPABASE_URL` must be set
- `SUPABASE_SERVICE_ROLE_KEY` must be set
- `STRICT_INGEST_TEST_SITE_ID` should point to a valid site UUID
- The database must contain at least one additional site row so cross-site fixtures can be created

## Expected Result

- All suites pass
- No skips
- No orphan `conversations`, `conversation_links`, or `sales` rows remain after rejected writes
- Foreign-site session ids are never reused or mutated across tenants

## Current Suites

- `tests/integration/conversation-create-cross-site-db.test.ts`
- `tests/integration/conversation-link-cross-site-db.test.ts`
- `tests/integration/sales-create-cross-site-db.test.ts`
- `tests/integration/session-cross-site-db.test.ts`

## When To Run

- Before merging conversation-layer tenant-scope changes
- After modifying `conversations`, `conversation_links`, `sales`, or session-ownership logic
- After changing route-level ownership checks for conversation or sales writes
- During adversarial hardening sprints

## Notes

- This gate is narrower and faster than `npm run test:integration`
- `UPSTASH` degraded-mode warnings are not part of this gate's pass/fail condition
- The authoritative invariant is DB rejection plus preserved pre-existing bindings
