# Testing strategy — OpsMantik

**Goals:** Fast PR feedback, no flaky tests, clear boundaries between unit / integration / smoke / E2E.

---

## 1. Pyramid

| Layer | Command / location | When it runs |
|-------|-------------------|--------------|
| **Unit** | `npm run test:unit` — [`tests/unit/*.test.ts`](tests/unit/) | Local + CI (via repo scripts) |
| **Integration (DB)** | `npm run test:integration` — [`tests/integration/`](tests/integration/) | Requires Supabase credentials; often local or protected CI |
| **Release gates** | `npm run test:release-gates` — tenant + OCI kernel + [`smoke:intent-multi-site`](scripts/smoke/p0_intent_multi_site.mjs) | [`release-gates.yml`](../.github/workflows/release-gates.yml) with secrets |
| **E2E** | `npm run e2e` — Playwright | Optional CI ([`e2e.yml`](../.github/workflows/e2e.yml)); needs `E2E_*` env |

---

## 2. Flaky test policy

1. **No silent retries** in test code to mask timing bugs (except documented single retry for external quota).
2. If a test fails intermittently on CI: **open an issue**, label `flaky`, fix root cause (deterministic clocks, isolate Redis mocks, stable DB ordering).
3. Quarantine: only with owner + deadline; prefer fix over skip.

---

## 3. Contract / golden tests (critical surfaces)

Maintain or extend tests when changing these areas:

| Area | Test files (examples) |
|------|------------------------|
| OCI export / value | `tests/unit/oci-export-preview.test.ts`, `oci-value-*.test.ts`, `oci-ssot-alignment.test.ts` |
| OCI script contract | `tests/unit/oci-script-contract.test.ts`, `oci-script-ack-failed.test.ts` |
| Determinism / kernel | `tests/unit/deep-determinism-regression.test.ts`, `oci-dedup-determinism.test.ts` |
| Sync / consent | `tests/unit/call-event-*.test.ts`, `gdpr-consent-gates.test.ts` |
| Tenant isolation | `tests/integration/*cross-site*.test.ts`, `test:tenant-boundary` |

**Rule:** Any change to export row shape, hash order, or Google Ads field mapping must include or update a unit test in the matching file.

---

## 4. Integration test strategy

- **PR:** Prefer `test:release-gates:pr` (`tenant-boundary` + `oci-kernel` only) when DB secrets are unavailable.
- **Main / nightly:** Run full `test:integration` + `smoke:intent-multi-site` when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.

Document secrets in [ONBOARDING.md](./ONBOARDING.md).

---

## 5. Smoke & deploy gate

Mandatory before production deploy per [`.cursor/rules/deploy-gate-intent.mdc`](../.cursor/rules/deploy-gate-intent.mdc):

```bash
npm run smoke:intent-multi-site
```

See [docs/OPS/DEPLOY_GATE_INTENT.md](./OPS/DEPLOY_GATE_INTENT.md).
