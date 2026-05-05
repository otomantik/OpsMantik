# OCI remediation — security and compliance follow-ups

## ACK JWS hardening (feature-gated)

- Route: `POST /api/oci/ack` now supports `OCI_ACK_REQUIRE_SIGNATURE`.
- Behavior:
  - `OCI_ACK_REQUIRE_SIGNATURE=false` (default): verify when `x-oci-signature` is present; fallback auth allowed.
  - `OCI_ACK_REQUIRE_SIGNATURE=true`: if `VOID_PUBLIC_KEY` exists and signature header is missing, request fails with `AUTH_FAILED` (401).
- Rollout:
  1. Enable signature emission in tenant scripts.
  2. Canary one tenant with `OCI_ACK_REQUIRE_SIGNATURE=true`.
  3. Expand to all tenants after ACK 401/403 baseline stabilizes.
  4. Keep fallback disabled in production after full rollout.

## GDPR / retention

- Reconciliation payloads must avoid raw PII (phone, full URL, IP). Prefer hashes or truncated tokens (`lib/oci/reconciliation-events.ts`).
- Define retention / anonymization policy for `marketing_signals`, `offline_conversion_queue`, and `oci_reconciliation_events` with legal owner; align with compliance freeze tests if extended.

### Operational backlog (owner + target)

- **Data owner + legal review:** define retention windows for:
  - `marketing_signals`
  - `offline_conversion_queue`
  - `oci_reconciliation_events`
- **Implementation owner (backend):** add scheduled purge/anonymize jobs after legal approval.
- **Verification owner (QA/SRE):** run contract checks that reconciliation payload never carries raw phone/IP/full URL keys.
