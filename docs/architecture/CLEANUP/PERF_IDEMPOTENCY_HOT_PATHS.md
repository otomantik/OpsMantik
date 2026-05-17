# Performance and idempotency — hot paths

## Hot routes

| Route | Concern |
|-------|---------|
| `POST /api/call-event` (+ v2) | Ingest latency, duplicate handling |
| `GET /api/oci/google-ads-export` | Batch size, Supabase round-trips |
| `POST /api/oci/ack` | Idempotent ACK, ledger consistency |

## Idempotency

- Postgres **23505** unique violations are used as success signals in several upsert paths — see `tests/unit/upsert-marketing-signal-idempotency.test.ts` and related OCI kernel tests.
- Outbox / queue inserts must remain safe under duplicate delivery (QStash, cron overlap).

## Serverless limits

Document max duration and payload size for export responses; if adding pagination, update [`PUBLIC_SCRIPT_API_CONTRACT.md`](./PUBLIC_SCRIPT_API_CONTRACT.md).
