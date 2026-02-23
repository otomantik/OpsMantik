# Call-Event DB Idempotency (Model B)

**Purpose:** Eliminate duplicate call inserts when Redis replay cache is down and requests land on multiple instances.
**Sprint:** Call-Event DB Idempotency Hardening.

---

## Why DB-Level Idempotency

- **Redis down + multi-instance:** Replay cache uses in-process Map fallback; each instance has its own Map. Same signed request can hit two instances → two inserts.
- **DB unique constraint:** Final guard. Redis remains performance layer; DB enforces correctness.

---

## Schema

### Column

```sql
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS signature_hash text;
```

- **Type:** `text`, nullable.
- **Computation:** `sha256(x-ops-signature)` as hex.
- **Existing rows:** NULL (no backfill).

### Unique Index

```sql
CREATE UNIQUE INDEX IF NOT EXISTS calls_site_signature_hash_uq
  ON public.calls (site_id, signature_hash)
  WHERE signature_hash IS NOT NULL;
```

- **Partial:** NULL `signature_hash` excluded (backward compat for unsigned/legacy).
- **Conflict:** Second insert with same `(site_id, signature_hash)` → 23505.

---

## signature_hash Computation

```javascript
import { createHash } from 'node:crypto';
const signatureHash = headerSig
  ? createHash('sha256').update(headerSig, 'utf8').digest('hex')
  : null;
```

- **Input:** `x-ops-signature` header (64 hex chars).
- **Output:** 64 hex chars (sha256 digest).
- **Deterministic:** Same signature → same hash.

---

## Behavior Matrix

| Scenario | First request | Second request (same signature) |
|----------|---------------|---------------------------------|
| Replay cache hit | 200 noop (from Redis) | 200 noop (from Redis) |
| Replay cache miss (e.g. Redis down) | Insert succeeds | 23505 → lookup by signature_hash → 200 noop, reason: idempotent_conflict |
| No signature (signing disabled) | Insert (signature_hash=NULL) | No DB conflict (NULL not in unique index) |

---

## Rollback

1. Revert route changes: stop writing `signature_hash`; remove 23505 signature_hash branch.
2. Optional: `DROP INDEX IF EXISTS calls_site_signature_hash_uq`
3. Optional: `ALTER TABLE calls DROP COLUMN IF EXISTS signature_hash` (not required; column can remain)

---

## Operational Notes

- **Index size:** One index entry per call with non-null `signature_hash`. Grows with call volume.
- **Hot site:** High-volume sites have more rows in the index; conflict checks remain O(1) lookups.
- **Locking:** Migration uses standard `CREATE INDEX` (not CONCURRENTLY). For large `calls` table, consider running index creation during low-traffic window or use a separate CONCURRENTLY migration.
