# OCI Conversion Time — Zero Tolerance Policy

## Policy (Mandatory)

For Google Ads OCI exports, conversion time is the first intent creation timestamp.

- SSOT source: `calls.created_at` (the first intent row creation time).
- Zero tolerance: no alternate business timestamp may override this for export time.
- Disallowed as primary conversion time: `sale_occurred_at`, `confirmed_at`, upload-time `now()`, worker process time.
- Allowed usage of alternate times: metadata, audit, chronology checks, operator notes.

## Write-path Contract

All write paths that produce OCI artifacts must preserve the same primary timestamp:

- `marketing_signals.google_conversion_time` must resolve from first intent creation time.
- `offline_conversion_queue.occurred_at` and `offline_conversion_queue.conversion_time` must resolve from first intent creation time.
- `conversion_time_source` must be explicit and auditable (for example `intent_created_at`).

## Export Contract

Export builders and providers must not re-interpret business time.

- Export may normalize format/timezone only.
- Export may not replace timestamp source.
- Google payload field `conversion_date_time` must be derived from the same first-intent timestamp.

## Incident Rule

If any record is exported with a timestamp not traceable to first intent creation time:

- Treat as P0 data-contract incident.
- Stop rollout, capture evidence, patch, and re-verify before resume.

## Verification Checklist

- Unit/contract tests pin source precedence to first intent timestamp.
- DB fail-closed guard migration is active: `supabase/migrations/20261226010000_oci_conversion_time_zero_tolerance_db_guard.sql`.
- Runbook SQL proof compares source columns against call first-created time: `docs/OPS/OCI_REMEDIATION_DEPLOY_AND_STAGING.md`.
- Pre-release gate includes this contract as fail-closed.
