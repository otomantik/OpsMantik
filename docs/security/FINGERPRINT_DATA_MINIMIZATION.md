# Fingerprint & device signals — minimization note

**Context:** Tracker and call-event flows may send device/fingerprint metadata for fraud and session correlation. EU/UK processing requires a **lawful basis** and data minimization.

**Engineering practices:**

- Only collect fields required for documented product behavior (session stitch, rate limits).
- Avoid logging raw fingerprints in application logs; prefer hashed or truncated identifiers in diagnostics.
- Consent: align with [`COMPLIANCE_CHANGE_GATE.md`](./COMPLIANCE_CHANGE_GATE.md) for any change to consent or collection.

**Product / legal:** Schedule periodic review with DPO or counsel for high-risk markets.

**Related:** [SECURITY.md](../architecture/SECURITY.md), [TIER1_BACKEND_AUDIT_2026.md](../architecture/AUDIT/TIER1_BACKEND_AUDIT_2026.md) (fingerprinting mention).
