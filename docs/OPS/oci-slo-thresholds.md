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
