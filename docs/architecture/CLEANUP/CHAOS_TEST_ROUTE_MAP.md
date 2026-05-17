# Chaos tests ↔ production surface map

| Test file | Scenario | Primary production touchpoints |
|-----------|----------|--------------------------------|
| `tests/chaos/duplicate-storm.test.ts` | Duplicate ingest / idempotency | `call-event`, marketing signals |
| `tests/chaos/ack-race.test.ts` | Concurrent ACK | `oci/ack`, ledger |
| `tests/chaos/outbox-zombie.test.ts` | Stuck outbox rows | outbox processors, `workers/oci/*` |
| `tests/chaos/marketing-signal-dispatch-matrix.test.ts` | Dispatch matrix | queue → export path |
| `tests/chaos/export-dual-path-gate.test.ts` | Dual export guards | `google-ads-export` |
| `tests/chaos/export-closure-adversarial.test.ts` | Export closure | export + reconciliation |
| `tests/chaos/export-closure-seal-audit-paths.test.ts` | Seal audit paths | seal + export |

If a route is deleted, update or delete the corresponding chaos test in the same PR series.
