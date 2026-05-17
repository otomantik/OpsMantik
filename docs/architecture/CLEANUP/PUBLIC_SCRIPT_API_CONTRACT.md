# Public script / embed API contract

## Documented surfaces (browser or Google Ads script)

| Surface | Method | Auth | Notes |
|---------|--------|------|------|
| `POST /api/call-event` | POST | — | **410 Gone** tombstone (no ingest; no rollback); use v2 |
| `POST /api/call-event/v2` | POST | Site signing secret / headers per route | Canonical intent ingest |
| `GET /api/oci/google-ads-export` | GET | `x-api-key` = `OCI_API_KEY` | Batch payload for MCC script |
| `POST /api/oci/ack` | POST | Script-signed body | Offline conversion ACK |
| `POST /api/oci/ack-failed` | POST | Script-signed body | Failure path |
| `GET /api/oci/v2/verify` | GET | Per route | Handshake for script fleet |
| `GET /api/sites/{id}/tracker-embed` | GET | Session (operator) | Snippet for customer sites |

## HTTP semantics

- **429** — rate limited; client SHOULD backoff with jitter.
- **503** — transient server / dependency failure; retry with cap.
- **400** — validation / bad signature; do not infinite-retry unchanged payload.

## Versioning

- Tracker asset [`/assets/core.js`](../../public) is canonical (built from `lib/tracker` via `npm run tracker:build`).
- Legacy [`/ux-core.js`](../../public) is a **shim only** (loads `/assets/core.js`); do not embed it on new sites.
- Both paths use short `Cache-Control` in `next.config.ts`; customers may append `?v=` when caching aggressively.

## Breaking changes

Any change to JSON field names on the above surfaces requires **ADR** + coordinated script rollout.
