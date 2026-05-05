# OCI Transaction and Notify Audit (L15)

## Sequence Audit

Expected write order:

1. stage/seal RPC commit
2. producer enqueue decision
3. outbox insert OR reconciliation persist
4. notify (`notifyOutboxPending`) only when outbox inserted

## Mandatory Rules

- No notify call when insert fails.
- No silent success when both insert and reconciliation persist fail.
- Retry policy must be bounded and idempotent.

## Manual Code Audit Checklist

- Confirm routes gate notify with `if (oci.outboxInserted)`.
- Confirm producer `ok` gate is fail-closed.
- Confirm retry path preserves idempotency (duplicate -> success collapse).

## Operational Note

If route returns success but no outbox insert:
- response must include reconciliation classification fields
- incident note must include route request id and call id
