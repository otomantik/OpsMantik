# Module boundaries — navigation map

**Purpose:** Answer “where does value / export / ingest live?” without spelunking the whole repo.

---

## Single sources of truth (SSOT)

| Topic | Document |
|-------|----------|
| OCI value engines, export math | [OCI_VALUE_ENGINES_SSOT.md](./OCI_VALUE_ENGINES_SSOT.md) |
| OCI queue / stuck thresholds | [OCI_QUEUE_HEALTH.md](./OCI_QUEUE_HEALTH.md) |
| ingest_idempotency scale backlog | [INGEST_IDEMPOTENCY_SCALE_BACKLOG.md](./INGEST_IDEMPOTENCY_SCALE_BACKLOG.md) |
| Funnel / ledger contracts | [FUNNEL_CONTRACT.md](./FUNNEL_CONTRACT.md) |
| Observability requirements | [OPS/OBSERVABILITY_REQUIREMENTS.md](./OPS/OBSERVABILITY_REQUIREMENTS.md) |

---

## Code areas (high level)

| Directory | Responsibility |
|-----------|------------------|
| [`app/api/sync`](../../app/api/sync/) | Public ingest; QStash → worker |
| [`app/api/call-event`](../../app/api/call-event/) | Call signals, replay, consent |
| [`app/api/oci`](../../app/api/oci/) | OCI export, ack, Google Ads surfaces |
| [`lib/oci`](../../lib/oci/) | Value engine, LCV, queue, guards, config |
| [`lib/domain/funnel-kernel`](../../lib/domain/funnel-kernel/) | Ledger, projection, policy |
| [`lib/domain/mizan-mantik`](../../lib/domain/mizan-mantik/) | Gear/value calculators (Mizan) |
| [`lib/ingest`](../../lib/ingest/) | Sync gates, site ingest config |
| [`lib/services`](../../lib/services/) | Intent, analytics, attribution orchestration |

**Rule:** New features should extend the smallest layer; avoid duplicating value math outside `lib/oci` + Mizan per SSOT doc.

---

## Public API surface (intentional)

- HTTP routes under `app/api/**/route.ts` are the external contract (tracker, partners, cron).
- Internal helpers in `lib/**` should not re-export business rules to the client; use server components / route handlers only.

---

## Legacy naming

Some Postgres RPCs retain historical names (e.g. analytics funnel). See [ADR 002](./adr/002-analytics-funnel-rpc-naming.md). Application code should call through [`AnalyticsService`](../../lib/services/analytics-service.ts) so renames are one place.
