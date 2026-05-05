# ADR 005: OCI Export Rate Limit and Request Correlation

## Status
Accepted

## Context

OCI export surfaces need deterministic abuse protection and reliable cross-layer traceability.

## Decision

1. Export-facing routes must remain rate-limited and fail-closed on abuse.
2. OCI write paths should carry request correlation identifiers into payload/metadata where safe.
3. Operational investigations must link API logs to outbox/reconciliation evidence with request id.

## Consequences

- Better incident MTTR for producer/worker mismatches.
- Safer export boundaries against brute-force and noisy callers.
- Small payload expansion for correlation metadata.
