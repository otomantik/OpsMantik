# Tier-0 API surface (core product)

These routes are the **minimum** mental model for “intent → operator → Google value”:

1. `POST /api/sync` — tracker / ingest entry (QStash → worker).
2. `POST /api/workers/ingest` — durable ingest execution.
3. `GET` / RPC-backed intent queue — `get_recent_intents_lite_v1` via panel hooks.
4. `GET /api/intents/:id/details` — lazy card hydration.
5. `POST /api/intents/:id/stage` — gear shift / junk from panel.
6. `POST /api/calls/:id/seal` — seal + OCI enqueue + outbox notify.
7. `POST /api/cron/oci-maintenance` — sweeps **and** batched OCI upload runner (replaces separate `process-offline-conversions` schedule).
8. `GET /api/health` — liveness.

**Tier-2** (billing, conversations CRM, debug, long-form reporting) should stay behind capability flags or separate release cadence so Tier-0 stays small.

## Attribution coupling note

`enqueueSealConversion` uses `getPrimarySource` / identity stitcher for click-id discovery. That couples OCI to **session + conversation** primitives; the merge plan is to narrow this to a dedicated attribution adapter so CRM schema churn cannot break OCI.
