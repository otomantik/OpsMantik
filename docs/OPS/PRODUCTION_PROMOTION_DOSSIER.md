# Production Promotion Dossier

## Release Candidate

- release_candidate_commit: `a9267b1`
- evidence_mode: `production`
- evidence_generated_at: `2026-05-08T16:06:24.624Z`
- evidence_artifacts:
  - `tmp/release-gates-production.md`
  - `tmp/release-gates-production.json`
  - `tmp/release-gates-latest.md`
  - `tmp/release-gates-latest.json`
  - `tmp/db-evidence-latest.md`
  - `tmp/db-evidence-latest.json`

## Promotion Decision Policy (GO / NO-GO)

GO is allowed only when all are true:
- `target_db_checked = true`
- `target_db_contract_status = TARGET_DB_GREEN`
- `blocking_failures = []`
- `unsafe_grant_count = 0`
- `rpc_contract_summary = TARGET_DB_GREEN`
- `migration_evidence_summary = TARGET_DB_GREEN`
- `row_scoped_recovery_smoke = TARGET_DB_GREEN`
- rollback/freeze drill is documented in runbook

NO-GO if any P0/P1 blocker exists.

Static green cannot authorize production. static green cannot authorize production. `release:evidence` and `release:evidence:local` are never sufficient alone.

## Evidence Summary Template

- target_db_checked: `true`
- target_db_contract_status: `TARGET_DB_GREEN`
- rpc_contract_summary: `TARGET_DB_GREEN` (`missing_count=0`, `signature_drift_count=0`, `unsafe_grant_count=0`)
- migration_evidence_summary: `TARGET_DB_GREEN`
- row_scoped_recovery_smoke: `TARGET_DB_GREEN`
- queue health summary: `TARGET_DB_CHECKED` (`scripts/sql/queue_health.sql` ran, row_count=4)
- won pipeline summary: `TARGET_DB_CHECKED` (`scripts/sql/won_pipeline_health.sql` ran, row_count=4, won missing leak semantics split active)
- value integrity summary: `TARGET_DB_CHECKED` (`scripts/sql/value_integrity_health.sql` ran, row_count=0)
- identity integrity summary: `TARGET_DB_CHECKED` (`scripts/sql/identity_integrity_health.sql` ran, row_count=0)
- OCI time SSOT summary: `TARGET_DB_CHECKED` (`scripts/sql/oci_time_ssot_health.sql` ran, row_count=2)
- export run integrity status: `EXPORT_RUN_INTEGRITY_UNVERIFIED` (not a blocker for current PR-8B.1 production DB contract proof)
- recovery integrity status: `RECOVERY_INTEGRITY_GREEN`

## Rollback / Freeze Drill Link

- Runbook: `docs/runbooks/OCI_HARDENING_OPERATIONS.md` (Production Export Freeze + Rollback Scenario Matrix)

## Risk Register

- R1: Production DB evidence is currently dependent on Supabase pooler endpoint reachability.
- R2: Pooler TLS negotiation may fail under strict cert-chain validation in some environments.
- R3: Export/recovery runtime integrity remains policy-driven and should be re-checked before live canary upload.

## SSL/pooler DSN caveat

- Production evidence connectivity passed with Supabase pooler DSN (`aws-1-eu-central-1.pooler.supabase.com`) and `sslmode=no-verify`.
- Earlier attempts with direct DB host (`db.<project-ref>.supabase.co`) and strict SSL mode failed in this runtime path.
- Keep DSN in environment/secret manager only; never commit credentials or full DSN.
- Before canary promotion, re-validate production evidence from CI with the same pooler/TLS posture.

## Blocker List

- none (for PR-8B.1 production DB contract proof scope)

## Waiver List

- (empty if none)

## Decision

- GO / NO-GO: `GO` (current artifact state)
- Decision owner: `release-owner`
- Decision timestamp: `2026-05-08T16:06:24.624Z`
- Notes: `GO` remains valid only while target DB evidence stays fresh/green and freeze-drill policy stays documented.
