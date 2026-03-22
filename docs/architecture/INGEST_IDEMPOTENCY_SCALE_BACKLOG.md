# ingest_idempotency — scale backlog

**Purpose:** Track proof and work items before committing to partition migrations.

| Item | Owner | Status |
|------|--------|--------|
| Row count + table size snapshot (staging/prod read) | Platform | Pending |
| Verify retention job runs (cron / `idempotency-cleanup`) | Platform | Pending |
| Explain plan for hottest insert/select paths | DBA | Pending |
| ADR 003 accepted + migration design | Platform | Draft |

**Reference:** [SCALING_INGEST_IDEMPOTENCY.md](./OPS/SCALING_INGEST_IDEMPOTENCY.md), [adr/003-ingest-idempotency-scaling.md](./adr/003-ingest-idempotency-scaling.md).
