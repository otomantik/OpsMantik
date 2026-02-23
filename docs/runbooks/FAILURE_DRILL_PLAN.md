# Failure Drill Plan — OpsMantik Sprint A

**Scope:** Backend engine only. Observability + failure injection. No business logic changes.
**Objective:** Prove system behavior under dependency failures and race conditions.

---

## Scenario A — Redis Unavailable (Replay Cache Failure)

### Behavior
- `ReplayCacheService` uses Redis for replay detection. On Redis error, mode `degraded` falls back to in-process `Map`.
- Call-event uses `mode: 'degraded'` → on Redis failure, local fallback; **no fail-closed**.

### How to Simulate
1. **Staging:** Stop Upstash Redis or block outbound to Redis (firewall / iptables).
2. **Local:** Set `ReplayCacheService._setRedisForTests(null)` in a dedicated test route (DO NOT add to prod).
3. **Chaos:** Use chaos-mesh or similar to kill Redis proxy.

### Expected Behavior
- No 500 flood.
- Replay detection may be degraded (in-process Map does not span instances); risk of duplicate insert if multiple instances receive same replay concurrently.
- No infinite retry storm; `checkAndStore` returns quickly on error.

### Expected Metrics
- `replay_degraded_count` increases.
- `replay_noop_count` may drop if local cache misses.
- `error_rate` < 1%.

### Abort Criteria
- 500 rate > 5% for 1 min.
- Duplicate insert detected (audit idempotency / calls table).

---

## Scenario B — Supabase Transient 500

### Behavior
- Call-event and sync rely on Supabase for `verify_call_event_signature_v1`, `resolve_site_identifier_v1`, session lookup, insert.
- Transient DB 500 should surface as 401 (verifier RPC fail) or 500 (insert fail).

### How to Simulate
1. **Staging:** Use Supabase maintenance window or DB proxy that returns 500 for a subset of requests.
2. **Chaos:** Inject 500 for `anonClient.rpc()` in a percentage of requests (via fault injection proxy).

### Expected Behavior
- Graceful 503 or 500; no infinite retry storm.
- Client receives deterministic error; no idempotency corruption (failed insert = no idempotency row).
- QStash worker: retries per config; no unbounded retries.

### Expected Metrics
- `call_event_error_rate` spike.
- `sync_error_rate` spike.
- No `idempotency_insert_count` without corresponding successful write.

### Abort Criteria
- Retry storm (requests/sec growing unbounded).
- Idempotency table inconsistent (duplicate keys, orphan rows).

---

## Scenario C — High Concurrency Race (Same Fingerprint, 5 Concurrent)

### Behavior
- Five concurrent call-events with **identical** signed payload (same fingerprint).
- Replay cache: first request stores key; subsequent 4 hit replay → 200 noop.
- Idempotency (sync): first insert wins; duplicates get `x-opsmantik-dedup: 1`.

### How to Simulate
1. **Load test:** Use k6 with 5 VUs, identical payload, `startTime` synchronized.
2. **Script:** `tests/load/race-condition-proof.md` documents exact curl/k6 commands.

### Expected Behavior
- Single billable write (1 call row or 1 idempotency row).
- Replay: 1× 200/204 (first), 4× 200 noop (replay).
- No duplicate charge; no OCI duplicate enqueue.

### Expected Metrics
- `replay_noop_count` = 4.
- `idempotency_insert_count` = 1 (or equivalent for call-event path).
- `duplicate_insert_detected_count` or dedup header count = 4.

### Abort Criteria
- Duplicate insert detected.
- Multiple billable rows for same fingerprint/signature.

---

## Execution Checklist

| Scenario | Simulate | Duration | Abort If |
|----------|----------|----------|----------|
| A (Redis) | Block Redis | 2 min | 500 > 5% |
| B (Supabase) | Transient 500 | 1 min | Retry storm |
| C (Race) | 5 concurrent identical | 1 run | Duplicate insert |

---

## Post-Drill Verification

1. Confirm no idempotency corruption (run reconciliation query).
2. Confirm no duplicate calls for same replay key.
3. Restore Redis/DB; verify normal operation within 5 min.
