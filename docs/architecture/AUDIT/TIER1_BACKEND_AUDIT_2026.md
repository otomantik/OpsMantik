# OpsMantik Tier-1 Backend Audit (Backend/API/Data Only)

**Date:** 2026-02. **Scope:** Backend, API, and data layer only. No frontend/UI.  
**Evidence base:** Codebase and docs only. Unproven claims marked explicitly.

---

## Executive Summary

OpsMantik is a **multi-tenant AdTech and revenue intelligence backend** built on Next.js API routes, Supabase (Postgres + RLS), QStash, and Redis. The **Revenue Kernel** is implemented with a ledger-first design: invoice authority is `ingest_idempotency` (Postgres) only; Redis is not used for billing. Attribution uses a fixed S1–S5 hierarchy. The **Conversation Layer** (sales → offline_conversion_queue) and **Watchtower** health checks are present. **Dispute export** and **invoice freeze** are implemented; **consent**, **right-to-erasure**, and **audit logs** are not. The **OCI (offline conversion) upload** to Google is **not** implemented in-repo—only export/pull for an external script. **Partitioning** exists for `sessions`/`events` but **not** for `ingest_idempotency`. **Metrics** persist to Redis but also use in-memory counters (weak in serverless). Overall: **strong financial determinism and tenant isolation**, **moderate operational maturity**, **missing global/compliance and scale hardening**.

---

## Scorecard Table

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Financial determinism | 88 | Single SoT (ingest_idempotency), reconciliation from Postgres, invoice_snapshot freeze, dispute export. No Redis in invoice path. -12: in-memory metrics and no proof of freeze run in CI. |
| Tenant isolation | 85 | RLS on key tables, tenant-scope audit, site_id on all critical writes. -15: no formal audit log of cross-tenant access attempts. |
| Attribution integrity | 75 | S1–S5 deterministic in code; attribution stored in sessions/events. -25: no proof of "accuracy" or match rates; GCLID/session linking depends on client and DB state. |
| Offline conversion loop completeness | 60 | Sale → queue PROVEN; export CSV PROVEN. **Upload to Google not in repo** (external script). -40: loop not closed inside the product. |
| Observability | 65 | Watchtower, GET /api/metrics (Redis + memory), ingest_publish_failures table. -35: metrics partly in-memory (serverless reset); no TSDB; no formal SLO alerting. |
| Data lifecycle management | 70 | 90-day idempotency cleanup cron + RPC; retention documented. -30: no partition drop for ingest_idempotency; no proven retention for events/sessions beyond partition creation. |
| Compliance readiness (GDPR/KVKK level) | 35 | No consent API, no right-to-erasure, no DPA in repo. PII scrubbing in Sentry only. Fingerprinting and device data collected. |

**Weighted global score (equal weights):** (88+85+75+60+65+70+35)/7 ≈ **68**.  
**Global SaaS readiness (EU/US):** **48/100**.

---

## Critical Risks

- Fingerprinting and device data collected without consent model; EU ePrivacy/ICO risk.
- No right-to-erasure endpoint or RPC.
- No audit log for billing/admin/sensitive actions.
- OCI upload to ad platforms is outside the product (export only).
- `ingest_idempotency` is not partitioned; breaking point ~10–20M rows/month.
- Metrics use in-memory fallback; unreliable in serverless (cold start reset).

---

## Architecture Maturity Level

**Growth** (post-startup): core billing and attribution are implemented and documented; financial determinism and tenant isolation are strong. **Not yet enterprise-ready** due to compliance gaps (consent, erasure, audit, DPA) and scale gaps (ingest_idempotency partitioning, metrics persistence).

---

## Revenue Loop Status

**Loop completeness: 72/100.**

- **Sale → queue:** PROVEN (confirm_sale_and_enqueue RPC; single transaction).
- **Queue → upload:** PARTIALLY PROVEN (claim_offline_conversion_jobs exists; no in-repo worker that calls Google Ads API).
- **Reconciliation authority:** PROVEN (COUNT(ingest_idempotency WHERE billable=true)).
- **Missing:** In-product OCI upload (or documented, supported upload path).

---

## Global SaaS Readiness

**48/100** for EU/US: strong on billing and isolation, weak on consent, erasure, audit, and fingerprinting/DPA.

---

## AI Readiness

- **Anomaly detection:** Ready (counts, drift via Watchtower and metrics).
- **ROAS modeling:** Possible only after OCI upload is closed or standardized.
- **Auto-bidding:** Would require clean conversion upload and attribution; not fully ready without in-product upload and clear conversion boundaries.

---

## Phase 1 — Truth Audit (What is ACTUALLY implemented)

| Claim | Status | Evidence |
|-------|--------|----------|
| Ingestion & session layer | PROVEN | `app/api/sync/route.ts`, `app/api/sync/worker/route.ts`, `lib/idempotency.ts`, `lib/quota.ts`, `supabase/migrations/20260214000000_ingest_idempotency_and_fallback.sql` |
| Attribution S1–S5 hierarchy | PROVEN | `lib/attribution.ts`: S1 GCLID, S2 UTM cpc/ppc/paid, S3 Ads Assisted, S4 Paid Social, S5 Organic |
| Revenue Kernel | PROVEN | `supabase/migrations/20260216000000_revenue_kernel_pr1.sql`, `lib/reconciliation.ts`, `lib/services/billing-reconciliation.ts` |
| Fail-secure billing | PROVEN | `app/api/sync/route.ts`: idempotency error → 500, no publish |
| Invoice freeze & dispute export | PROVEN | `app/api/cron/invoice-freeze/route.ts`, `app/api/billing/dispute-export/route.ts` |
| Conversation Layer | PROVEN | `supabase/migrations/20260218000000_conversation_layer_tables.sql`, `app/api/sales/confirm/route.ts` |
| Watchtower | PROVEN | `lib/services/watchtower.ts`, `app/api/cron/watchtower/route.ts` |
| Tenant isolation (RLS) | PROVEN | `tests/rls/tenant-rls-proof.test.ts`, ingest_idempotency policies in migrations |
| RBAC | PROVEN | `lib/auth/rbac.ts`, `lib/security/validate-site-access.ts`, `lib/auth/is-admin.ts` |
| Idempotency lifecycle | PROVEN | `app/api/cron/idempotency-cleanup/route.ts`, `supabase/migrations/20260217000000_idempotency_cleanup_batch_rpc.sql` |
| OCI export | PROVEN | `app/api/oci/export/route.ts` |
| OCI upload to Google | UNPROVEN | No route or worker calling Google Ads API in repo. |
| Consent model | UNPROVEN | No backend consent API or consent table. |
| Right-to-erasure | UNPROVEN | No endpoint or RPC to delete/anonymize by request. |
| Audit logs | UNPROVEN | No audit_log table or structured audit trail. |
| Partitioning on ingest_idempotency | NOT IMPLEMENTED | Table is plain; sessions/events are partitioned in `20260129100000_hunter_db_phase1.sql`. |

### Risky or unverifiable claims

- **SLO doc** (`docs/OPS/SLO_SLA.md`): "99.9% of valid requests", "±0.0% Billing Accuracy" — aspirational; not proven by tests.
- **Fingerprinting:** Client sends fingerprint and hardware-like meta; stored server-side. Compliance risk in EU.
- **PII:** Sentry scrubs PII per docs; no in-app DPA or retention schedule in repo.

---

## Phase 2 — Global SaaS Gap Summary

- **P0 (critical):** Consent model, fingerprinting/DPA risk, right-to-erasure, audit log, metrics not reliably persistent (serverless), OCI upload not in-product.
- **P1 (important):** Data minimization, retention schedule doc, RBAC granularity, key-rotation runbook, alerting/escalation, SLO automation.
- **P2 (future scale):** Secrets vault, DR, multi-region.

---

## Phase 3 — Revenue Feedback Loop (detail)

- Sale → queue: PROVEN (confirm_sale_and_enqueue RPC).
- Queue → upload worker: claim_offline_conversion_jobs exists; upload to Google not in repo.
- Late attribution update: update_offline_conversion_queue_attribution and kernel hardening exist.
- Duplicate protections: Idempotency + sales 409 + queue ON CONFLICT. Strong.
- Reconciliation final authority: Postgres COUNT(ingest_idempotency WHERE billable=true).

---

## Phase 4 — Scale Simulation (1,000 tenants; 50M events/month; 500k sales/month)

- **ingest_idempotency:** ~50M rows/month; table not partitioned; breaking point ~10–20M rows/month without partitioning.
- **Partitioning:** Mandatory for 50M/month (e.g. by year_month or created_at).
- **Queue/reconciliation:** FOR UPDATE SKIP LOCKED; manageable with frequent cron.
- **Required upgrades:** Partition ingest_idempotency; Redis-only or TSDB for metrics; document cleanup and freeze order.

---

## Phase 5 — AI Layer (summary)

Signals and attribution are deterministic (S1–S5); revenue signal tied to sales and queue. No dedicated feature store. Ready for anomaly/drift; ROAS/auto-bidding need closed upload path.

---

## Phase 6 — Global Positioning

**What OpsMantik REALLY is:** Multi-tenant backend for event ingestion, session and call tracking, and revenue attribution. Sync/call-event APIs, per-site rate limit and quota, Postgres idempotency ledger as billing SoT, reconciliation, conversation/sales layer, offline conversion queue (export). Watchtower for health/drift. RLS and site-scoped access.

**What it is NOT:** Consent management platform, full GDPR/KVKK suite, in-product ad-platform upload service, audit logging, right-to-erasure APIs, multi-region in-repo.

**12-month roadmap to Tier-1 global SaaS:**

- **Months 1–3:** Consent API and storage; data minimization policy; right-to-erasure endpoint; audit log table and write path for billing/admin.
- **Months 4–6:** DPA and subprocessor list; key-rotation and IR runbooks; metrics Redis-only or TSDB; SLO alerting.
- **Months 7–9:** Partition ingest_idempotency; prove cleanup and freeze in CI; optional in-product OCI upload or certified upload path.
- **Months 10–12:** Multi-region and DR design; RBAC refinement; formal penetration and compliance review.

---

## Post–G1–G5 update (2026-02)

**Now present:** Audit log table + billing/admin write path (G5); in-product OCI upload (G4 worker + G3 adapter + G1 vault); provider credentials vault (G1).

| Dimension | Previous | New | Rationale |
|-----------|------|------|--------|
| Tenant isolation | 85 | **92** | Billing/admin için audit_log; cross-tenant denemeleri izlenebilir. |
| Offline conversion loop | 60 | **88** | Sale → queue → **upload (in-repo)**; worker + Google Ads adapter + vault. |
| Compliance readiness | 35 | **48** | Audit log tamamlandı; consent ve right-to-erasure hâlâ yok. |

**New weighted score (equal weights):** (88+92+75+88+65+70+48)/7 ≈ **75**.  
**Global SaaS readiness (EU/US):** **~56/100** (increase from audit + closed OCI loop; consent/erasure still missing).

---

All conclusions are tied to file paths and code evidence; unproven or marketing claims are marked UNPROVEN or aspirational.
