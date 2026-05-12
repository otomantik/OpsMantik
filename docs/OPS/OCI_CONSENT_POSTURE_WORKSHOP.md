# OCI × marketing consent — workshop checklist (L21)

**Status:** Product + legal **TODO** — technical paths may allow OCI while regulatory posture requires explicit marketing consent scopes.

## Questions for workshop

1. **Panel OCI producer** (`enqueuePanelStageOciOutbox`): Is “Ads click present on matched session” sufficient for upload eligibility, or must **`consent_scopes`** (or equivalent) also be true for the call/session?
2. **Seal / won path** vs **signal** paths: Same bar, or stricter for revenue-bearing conversions?
3. **Erasure / compliance freeze:** When identifiers are frozen, what is the **retention** story for `oci_reconciliation_events` and queue rows? (Align with [`tests/unit/compliance-freeze.test.ts`](../../tests/unit/compliance-freeze.test.ts) invariants.)

## Engineering inputs (already in repo)

- Seal enqueue: marketing consent checks in [`lib/oci/enqueue-seal-conversion.ts`](../../lib/oci/enqueue-seal-conversion.ts) (`hasMarketingConsentForCall`).
- Panel producer: documented in [`docs/runbooks/OCI_SSOT_TROUBLESHOOTING.md`](../runbooks/OCI_SSOT_TROUBLESHOOTING.md); precursor flag `OCI_INTENT_PANEL_PRECURSOR_CONTACTED_ENABLED`.

## Outcome to capture

- Single **decision table**: stage × surface × consent required (Y/N) × audit reason if blocked.
- Update runbooks and, if needed, **code gates** after sign-off.
