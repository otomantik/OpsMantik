# OCI Occurred At Phased Rollout

## Phase 1

- Add canonical timestamp metadata to `marketing_signals` and `offline_conversion_queue`.
- Add V5 sale-time metadata fields to `calls`.
- Backfill historical rows without rewriting external Google state.

## Phase 2

- `marketing_signals` writes now persist canonical `occurred_at` metadata from stage event time.
- `seal` writes now accept optional `sale_occurred_at` and `entry_reason`.
- `apply_call_action_v1` persists V5 canonical time metadata and forwards it into `outbox_events`.
- `enqueueSealConversion()` writes canonical `occurred_at` into `offline_conversion_queue`.

## Phase 3

- `/api/oci/google-ads-export` now prefers canonical `occurred_at`.
- Export falls back to legacy timestamps only when canonical data is absent and still within sanity window.
- Missing or invalid timestamps are skipped with error logs instead of being silently normalized.

## Phase 4

- `sale_occurred_at` is blocked when it predates the attributed click/session chronology floor.
- Backdated sales older than 48 hours enter `PENDING_APPROVAL`.
- Approval endpoints:
  - `POST /api/calls/[id]/sale-review`
  - `POST /api/sales/[id]/review`
- Audit payloads index `entry_reason` for operator review and forensic search.

## Not In Scope Yet

- Retroactive Google Ads adjustment/replay for historical uploads.
- Full audit-log diffing for manual `occurred_at` edits.
- Click-time chronology enforcement at write time for every provider.
