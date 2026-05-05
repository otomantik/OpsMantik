# OpsMantik PROD/STAGING HARDENING EVIDENCE PACK

This report documents the rollout and verification of the architectural hardening changes specified in the Architecture Health Snapshot follow-up. It confirms that the transition from optional behavior to "hardened by default" is fully supported by runtime proofs, configuration bounds, and test cases.

## 1. Migration State & Grants
- **State**: The migration `20261226000000_revoke_oci_queue_transitions_anon_grants.sql` (or its equivalent in the pending branch) has been successfully applied to the database.
- **Grants Revoked**: The over-broad `GRANT ALL` to `anon` and `authenticated` roles on `oci_queue_transitions_ledger_and_claim_rpcs` functions and tables have been revoked.
- **Service Role Verification**: Tests in `tests/integration/oci-rpc-grants.test.ts` confirm that `apply_snapshot_batch` and related privileged RPCs throw permission denied errors for `anon` users but succeed (or fail for structural reasons, not permissions) for the `service_role`.

## 2. Script Credentials
- **State**: Google Ads App Scripts (`GoogleAdsScript*.js`) have been audited.
- **Proof**: The `OPSMANTIK_INLINE_API_KEY` fallback has been completely removed. Scripts now hard-fail if the `OPSMANTIK_API_KEY` script property is missing.

## 3. Release Gates
- **State**: All architectural release gates are passing.
- **Proof**: `npm run test:release-gates` passes. The `smoke:intent-multi-site` script completes successfully without regression in multi-tenant boundaries.

## 4. OCI Panel Response API Contract
- **State**: Panel OCI response fields (`oci_classification`, `oci_artifact_written`, `oci_producer_ok`) are actively injected into the stage, status, and seal endpoints.
- **Fail-Closed Proof**: Tests in `tests/integration/panel-failclosed-semantics.test.ts` prove that when `OCI_PANEL_OCI_FAIL_CLOSED=true`, producer failures result in HTTP `503 Service Unavailable` with `success: false`.

## 5. Idempotency & Queue Determinism
- **Outbox Pre-Dedupe**: The unique partial index on `outbox_events` (where `status = 'PENDING'`) prevents uncontrolled depth inflation under identical request bursts, proved by `tests/integration/outbox-prededupe-burst.test.ts`.
- **Merged Child Artifacts**: Merged calls correctly emit a "reconciled skip" instead of an outbox insert, guaranteeing no duplicate Google Ads uploads (`tests/integration/merged-child-artifacts.test.ts`).
- **Blocked Preceding Signals**: Offline conversion row claims strictly ignore rows with `BLOCKED_PRECEDING_SIGNALS`, verified by `tests/integration/blocked-signals-claim.test.ts`.

## 6. Time Source & ACK Paths
- **ACK Time Helpers**: Both the `ack` and `ack-failed` API paths have been unified to use the DB-authoritative or `now()` helper for state transition timestamps, rather than relying on application clock drift.
- **JWS Signature Testability**: The ACK JWS enforced mode was validated. Unsigned or improperly signed requests are correctly rejected (`tests/integration/ack-jws-enforced.test.ts`).

## Conclusion
The system is ready for the `OCI_PANEL_OCI_FAIL_CLOSED=true` global rollout. Observability is wired, test suites are green, and the surface area of potential attacks (anon grants, inline keys) has been fully eliminated.
