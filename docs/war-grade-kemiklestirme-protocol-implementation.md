# OpsMantik War-Grade Kemiklestirme Protocol Implementation

This document is the executable implementation contract for the war-grade protocol. It defines measurable SLOs, fail-closed release gates, incident choreography, governance law, and super-sprint sequencing for Code/DB/Runtime/Governance control planes.

## 1) Plane SLOs and Release Blocker Mapping

### Plane A — Contract Plane (Behavior Truth)
- **SLO-A1 Mutation determinism:** 99.5%+ first-attempt or one-shot-retry success on critical mutations (`status`, `stage`, `seal`) per release window.
- **SLO-A2 Ambiguous conflict zero:** 0 unresolved ambiguous `409` class outcomes in critical mutation routes.
- **SLO-A3 Signature stability:** 100% critical RPC signatures and permission contracts match expected contract packs.

**Release blockers**
- Any failed contract test for critical mutations.
- Any ambiguous `409` returned from a critical mutation endpoint.
- Any RPC contract/grant mismatch reported by contract health pack.

### Plane B — Data Plane (State Truth)
- **SLO-B1 Invariant lock:** 100% P0/P1 invariants enforced by DB constraints/triggers or explicitly tagged app-only with owner approval.
- **SLO-B2 Security-definer posture:** 100% SECURITY DEFINER functions have fixed `search_path` and least-privilege execute grants.
- **SLO-B3 Drift explainability:** 0 unexplained repo-vs-remote schema drift objects at release cut.

**Release blockers**
- Any critical invariant drift from green baseline.
- Any security advisor regression in exposed schemas.
- Any unexplained migration drift item.

### Plane C — Runtime Plane (Execution Truth)
- **SLO-C1 Heartbeat freshness:** 100% critical scheduled jobs report heartbeat within 60 minutes.
- **SLO-C2 Queue liveness:** stale `PROCESSING` backlog remains under threshold and rescue latency is under operational cap.
- **SLO-C3 Retention efficacy:** every retention run emits `rows_scanned/rows_affected/duration/cutoff`.

**Release blockers**
- Missing or stale heartbeat on any critical scheduler job.
- Cleanup/retention job ran without evidence payload.
- Queue liveness metric is red against agreed thresholds.

### Plane D — Governance Plane (Decision Truth)
- **SLO-D1 Owner decision closure:** 100% release-impacting drift/residue items have explicit owner decision status.
- **SLO-D2 Deletion law:** 100% destructive changes include approval, rollback rehearsal evidence, and two-release observation proof.
- **SLO-D3 Legacy quarantine compliance:** 100% residue candidates pass quarantine telemetry phase before deletion proposal.

**Release blockers**
- Any release-impacting item without owner decision.
- Any destructive proposal without rollback rehearsal evidence.
- Any legacy deletion attempted before two-release observation closes.

## 2) Fail-Closed Gate Engine and Evidence Payload Contracts

Gate result is `FAIL` unless all required evidence is fresh, complete, and green.

### Required gate inputs
- **Contract health:** RPC signature/grant and mutation contract test outputs.
- **Data health:** migration drift report, security advisor delta, invariant SQL packs.
- **Runtime health:** scheduler heartbeat health pack + cleanup efficacy evidence.
- **Governance health:** owner decision registry status and residue/drift ledger.

### Evidence payload contract (minimum fields)
- `contract_version`
- `generated_at`
- `git_commit`
- `git_branch`
- `environment`
- `checks[]` with `name`, `status`, `reason_code`, `duration_ms`
- `blocking_failures[]`
- `overall_status`

### Runtime heartbeat payload contract
- `job_name`
- `route_path`
- `last_status`
- `last_started_at`
- `last_finished_at`
- `last_duration_ms`
- `last_rows_affected`
- `last_error_code`
- `heartbeat_age_seconds`
- `contract_status`

### Fail-closed rules
- Missing required payload field => `FAIL`.
- Any critical check status `FAIL` => `FAIL`.
- Any stale/absent heartbeat in critical jobs => `FAIL`.
- Any unexplained drift => `FAIL`.
- Any release-impacting unresolved governance item => `FAIL`.

## 3) Incident Choreography (Contain, Diagnose, Recover, Immunize)

### Stage 0 — Contain
- Freeze dangerous write surfaces with feature flags or route guardrails.
- Keep queue/idempotency state intact; avoid destructive emergency DB edits.

### Stage 1 — Diagnose
- Classify incident plane (`contract`, `data`, `runtime`, `governance`).
- Capture forensic packet: `request_id`, route, RPC, key row IDs, timestamps, actor, error code.

### Stage 2 — Recover
- Apply additive, reversible patch (code or migration).
- Run targeted smoke tests for affected plane plus cross-plane sanity checks.
- Re-run gate subset for impacted checks before reopening mutation surface.

### Stage 3 — Immunize
- Add regression test and/or health signal that would have caught incident pre-release.
- Update owner decision ledger if ambiguity/legacy residue caused incident.
- Promote new signal to release-gate blocker if severity was release-impacting.

## 4) Permanent Drift and Legacy-Residue Governance

## 4.1 Drift registry model
Each release maintains a drift ledger row with:
- object id (`schema`, `name`, `type`)
- direction (`remote_only`, `repo_only`, `behavior_drift`)
- classification (`system`, `env_specific`, `approved_hotfix`, `blocker`)
- owner
- decision (`accept`, `backfill_migration`, `quarantine`, `block_release`)
- ETA and status

Unknown classification is always blocker by default.

## 4.2 Legacy residue governance
Residue class options:
- `active_compat`
- `forensic_hold`
- `owner_decision_required`

Lifecycle:
1. Binding proof matrix across runtime/scripts/tests/docs/scheduler.
2. Deprecation banner + telemetry insertion.
3. Two-release observation with zero-impact confirmation.
4. Rollback rehearsal.
5. Owner-approved removal migration.

## 4.3 Owner decision flow
1. Contributor files release-impacting item.
2. Plane owner assigns classification and risk.
3. If destructive or uncertain: architecture owner + product owner dual approval required.
4. Gate engine consumes decision state; unresolved criticals block release.

## 5) Super-Sprint Cadence with Entry/Exit Criteria

### Super-Sprint A — Contract Spine and Conflict Immunity
- **Entry:** critical mutation tests exist and baseline pass rate known.
- **Exit:** deterministic mutation behavior enforced, ambiguous 409s eliminated, contract tests release-gated.

### Super-Sprint B — DB Security and Invariant Lock
- **Entry:** inventory of SECURITY DEFINER/grants/RLS and invariants complete.
- **Exit:** security-definer lock and grant minimization complete; invariant health included in gate evidence.

### Super-Sprint C — Runtime Truth and Retention Efficacy
- **Entry:** critical cron topology mapped and owners assigned.
- **Exit:** heartbeat contract live for critical jobs, retention efficacy emitted, freshness gate active.

### Super-Sprint D — Governance and Residue Convergence
- **Entry:** drift/residue ledger initialized with owner mappings.
- **Exit:** owner decision law enforced in release gates, quarantine lifecycle active, destructive workflow governed by rehearsal law.

## 6) Implementation Status in This Change

- Runtime heartbeat schema and secured write surface added (`cron_job_heartbeats`, `upsert_cron_job_heartbeat`).
- Critical cron routes now emit runtime heartbeats (`oci-maintenance`, `cleanup`).
- Scheduler heartbeat SQL health pack added for gate evidence integration.
- Release evidence contract extended with scheduler heartbeat pack.
