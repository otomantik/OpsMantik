# Public script / embed API contract

## Documented surfaces (browser or Google Ads script)

| Surface | Method | Auth | Notes |
|---------|--------|------|------|
| `POST /api/call-event` | POST | — | **410 Gone** (sunset 2026-05-10); use v2 |
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

- Tracker asset [`/assets/core.js`](../../public) uses short `Cache-Control` in `next.config.ts` so fixes propagate; customers may still append `?v=` when caching aggressively.

## Breaking changes

Any change to JSON field names on the above surfaces requires **ADR** + coordinated script rollout.
