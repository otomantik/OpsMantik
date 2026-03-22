# Compliance & consent change gate

**Scope:** GDPR, consent scopes, erase flows, and “freeze” behaviors that affect legal posture.

---

## When this gate applies

Mandatory review **before merge** if the PR:

- Changes `consent_scopes`, CMP integration, or 204 consent-missing behavior.
- Touches [`lib/gdpr/`](../../lib/gdpr/), [`app/api/gdpr/`](../../app/api/gdpr/), or sync/call-event consent checks.
- Changes **compliance freeze** / frozen fields in intent or pipeline tests.
- Modifies retention or erase semantics (`gdpr_erase_requests`, etc.).

---

## Checklist

1. **Unit tests:** Update or add tests under `tests/unit/compliance-freeze.test.ts`, `gdpr-consent-gates.test.ts`, or related files.
2. **Docs:** Note behavior change in [SECURITY.md](../architecture/SECURITY.md) or a short ADR if policy shifts.
3. **Product/Legal:** For material changes, obtain explicit sign-off (email/ticket ID referenced in PR description).
4. **No PII in logs:** Confirm Sentry scrubbing still applies ([`lib/security/sentry-pii.ts`](../../lib/security/sentry-pii.ts)).

---

## CI

`npm run test:unit` includes compliance-related tests. Integration tests may require DB secrets—see [TESTING_STRATEGY.md](../TESTING_STRATEGY.md).

---

## Related

- [docs/architecture/SECURITY.md](../architecture/SECURITY.md)
- [docs/architecture/OPS/OBSERVABILITY_REQUIREMENTS.md](../architecture/OPS/OBSERVABILITY_REQUIREMENTS.md) (consent_missing spike)
