# Advanced Assurance (Deferred Track)

This track is intentionally deferred and must not block near-term OCI production hardening.

## Deferred Items

- TLA+ model checking
- XDP/eBPF prefilter
- SGX/SEV attestation for value engine

## Why Deferred

- Current production risk is dominated by contract drift, duplicate intent invariants, and release gate enforcement.
- These items are valuable but do not close immediate rollout blockers in the next 1-2 sprints.

## Start Preconditions

- Contract/migration/runtime parity gates are stable.
- Duplicate/session invariants are proven in DB-backed race tests.
- Strict readiness and canary gates are enforced and green across release cycles.
