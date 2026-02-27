# ARCHITECTURAL AUDIT: Global SaaS Scalability & Multi-Tenant Isolation

**Status**: DRAFT  
**Auditor**: Principal Global SaaS Architect (Antigravity)  
**Date**: 2026-02-27

---

## 1. Data Isolation & Security (The 'Leak' Test)

### Current State: **Hybrid-Manual Isolation**
- **User-Facing API**: Excellent. Supabase RLS is strictly configured on `sites`, `sessions`, `calls`, etc., using `auth.uid()`.
- **Background Workers**: **HIGH RISK**. Workers (Ingest, OCI Runner) utilize the `adminClient` (Service Role Key). RLS is **bypassed** by design.
    - *Vulnerability*: Isolation relies entirely on the developer's discipline to include `.eq('site_id', siteId)` in every query.
    - *Finding*: In `lib/oci/runner.ts`, we see site-filtered queries, but no global "Tenant Context" wrapper exists.

### Recommendation: **Strict Tenant Context Pattern**
Implement a `TenantDatabaseService` wrapper for all background workers that forces a `site_id` into every query factory, significantly reducing the surface area for data leaks.

---

## 2. Concurrency & Rate Limiting (The 'Storm' Test)

### Current State: **IP-Based Limitation (Missing Tenant Quotas)**
- **Protection**: `RateLimitService` (via Upstash Redis) prevents IP-based floods.
- **Architectural Match**: QStash acts as a massive shock absorber. If 50k leads hit the endpoint, QStash will buffer them and release them at a controlled rate (determined by worker parallelism).
- **The "Noisy Neighbor" Problem**: A single large tenant can saturate the entire processing queue. Currently, we have no mechanism to prioritize "Tenant A" over "Tenant B" if they both flood the system.

### Recommendation: **Per-Tenant Flow Control**
Introduce `tenant_concurrency_limit` in the `sites` table. Update the Ingest route to check total active jobs per `site_id` before enqueuing to QStash.

---

## 3. Scaling the Brain Score Engine

### Current State: **Synchronous Bottleneck**
- **Process**: Scoring is done **in-line** within the ingest worker (`process-call-event.ts`).
- **Risk**: As rules increase from 5 to 50, ingestion latency will spike. If scoring a lead takes 500ms, the worker is blocked, increasing costs and risk of timeouts.

### Recommendation: **Decoupled Scoring (Async Pattern)**
Move the `ScoringEngine` to a separate task.
1. Ingest saves the record with `status='pending_score'`.
2. Second QStash trigger handles `calc-brain-score`.
3. UI remains responsive while the "Brain" processes in the background.

---

## 4. Resilience & Error Handling (The 'Resilience' Test)

### Current State: **Soft Retries (No DLQ Strategy)**
- **OCI Pipeline**: Uses a `status` field (`QUEUED`, `PROCESSING`, `SYNCED`, `RETRY`).
- **The "6-Hour Downtime" Scenario**: The system self-heals by moving jobs to `RETRY`, and the `recover-stuck-jobs` cron re-queues them.
- **Missing Link**: There is no **Dead Letter Queue (DLQ)** for permanently failed conversions (e.g., malformed GCLIDs). These records will hang in the db or rotate indefinitely.

### Recommendation: **Permanent DLQ & Alerting**
Add a `FATAL` status to the OCI queue. After 8 retries, move the record to `FATAL` and trigger a Webhook alert for the developer.

---

## Critical Hardening: The Top 3 Priorities

1.  **[P0] Tenant-Aware DB Client**: Create a factory that produces a site-limited Supabase client for workers. NO `adminClient` calls should be naked.
2.  **[P1] Async Scoring Pipeline**: Decouple the Brain Score from the primary database write to ensure <100ms ingestion latency.
3.  **[P1] Global Tenant Quotas**: Implement aggregate rate limits per `site_id` (e.g., maximum leads per month/day) to protect system resources and billing.

---

**Summary**: The "Motor" is powerful and well-architected for a Beta. Transitioning to a Tier-1 SaaS requires shifting from "Trusting the Developer" to "Enforced Infrastructure Patterns".
