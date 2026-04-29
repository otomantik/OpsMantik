# OCI SLO Thresholds

Near-term production rollout thresholds for OCI queue integrity.

## Core SLI Metrics

- `stuckProcessing`: processing rows older than 15 minutes
- `retryRate`: `RETRY / totalQueue`
- `failedRate`: `(FAILED + DLQ) / totalQueue`
- `outboxQueueParityRatio`: outbox-to-queue parity indicator

## Environment Profiles

- `dev`
  - `stuckProcessing <= 50`
  - `retryRate <= 0.50`
  - `failedRate <= 0.35`
- `stage`
  - `stuckProcessing <= 30`
  - `retryRate <= 0.40`
  - `failedRate <= 0.25`
- `prod`
  - `stuckProcessing <= 20`
  - `retryRate <= 0.30`
  - `failedRate <= 0.20`

## Rollout Policy

- Canary starts only if strict readiness passes with target profile.
- Any threshold breach during canary => stop rollout, investigate, and re-run strict readiness.
- Global rollout is allowed only after sustained canary pass.

## Strict Failure Codes

- `no_sites_found`
- `no_auth_ready_sites`
- `schema_drift_detected`
- `missing_entitlement_rpc`
- `missing_api_key_sites`
- `missing_google_ads_sync_capability`
- `observability_gate_failures_present`
- `no_canary_candidate`

## Actionable Readiness Payload

`node scripts/oci-rollout-readiness.mjs --strict --json` returns operator patch lists:

- `actionable.missingApiKeySites`
- `actionable.missingEntitlementSites`
- `actionable.missingEntitlementRpcSites`
- `actionable.schemaDriftSites` (includes missing table names per site)
