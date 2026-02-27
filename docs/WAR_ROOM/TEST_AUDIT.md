# OpsMantik Test Audit Report

**Date:** 2026-02-25  
**Run:** `npm run test:unit`  
**Environment:** Node.js (deterministic, no external services)  
**Summary:** 339 total tests | 319 pass | 14 fail

---

## Executive Summary

All 14 failing tests are classified as **TEST_BUG**. They assert on the **legacy sync/call-event architecture** (inline idempotency, quota, direct DB insert). Production has moved to a **QStash + worker** design: `/api/sync` and `/api/call-event/v2` now publish to QStash; idempotency, quota, and entitlements run in `/api/workers/ingest`. Tests have not been updated to reflect this.

| Classification | Count |
|----------------|-------|
| TEST_BUG       | 14    |
| REAL_BUG       | 0     |
| FLAKY          | 0     |
| ENV_CONFIG     | 0     |

---

## Failing Tests

### 1. call-event-db-idempotency.test.ts

| Field | Value |
|-------|-------|
| **Test** | A) 23505 conflict returns 200 noop and signature_hash lookup path exists |
| **Failure** | `v2 must handle unique violation 23505` |
| **Stack** | `call-event-db-idempotency.test.ts:18:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Test expects `call-event/v2` to have direct `adminClient.from('calls').insert` with `insertError.code === '23505'` handling. V2 publishes to QStash; the worker performs the insert. 23505 is handled in the worker, not the route. |
| **Fix plan** | Update test to assert 23505 handling exists in `app/api/workers/ingest/route.ts` (or call-event worker path), or to assert that v2 route contains `signature_hash` in the QStash payload and documents the idempotency flow. |
| **PR** | PR-T1 |

---

### 2. call-event-db-idempotency.test.ts

| Field | Value |
|-------|-------|
| **Test** | C) Consent gate still prevents DB insert (analytics missing → 204) |
| **Failure** | `both consent and insert must exist` |
| **Stack** | `call-event-db-idempotency.test.ts:40:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Test expects both consent gate and insert path in the same route. V2 has consent gate but no insert—insert happens in worker. Consent gate still prevents enqueue when analytics missing. |
| **Fix plan** | Update test to assert: (a) consent gate exists in v2 route before QStash publish, and (b) analytics-missing path returns 204 without publish. Remove requirement for `insert` in the route. |
| **PR** | PR-T1 |

---

### 3. compliance-freeze.test.ts

| Field | Value |
|-------|-------|
| **Test** | COMPLIANCE: consent gate executes BEFORE idempotency |
| **Failure** | `tryInsert must exist` |
| **Stack** | `compliance-freeze.test.ts:37:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Test expects sync route to contain `tryInsert`. Sync route no longer has tryInsert; idempotency runs in worker. |
| **Fix plan** | Update test to assert: consent gate runs before QStash publish in sync route, and idempotency runs in worker after publish. Or assert the worker has consent-before-idempotency ordering. |
| **PR** | PR-T2 |

---

### 4. compliance-freeze.test.ts

| Field | Value |
|-------|-------|
| **Test** | COMPLIANCE: idempotency path unreachable when consent fails (204 return before tryInsert) |
| **Failure** | `tryInsert must exist` |
| **Stack** | `compliance-freeze.test.ts:46:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Same as #3: test assumes tryInsert in sync route. Consent fails → 204 before publish; worker never runs. |
| **Fix plan** | Assert: consent failure returns 204 before `publishToQStash` (or equivalent publish). No tryInsert required. |
| **PR** | PR-T2 |

---

### 5. compliance-freeze.test.ts

| Field | Value |
|-------|-------|
| **Test** | COMPLIANCE: sync route contains compliance invariant comment |
| **Failure** | `Sync route must contain explicit COMPLIANCE INVARIANT comment` |
| **Stack** | `compliance-freeze.test.ts:52:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Test expects sync route to include literal `COMPLIANCE INVARIANT` (or similar). Sync route lacks that exact comment. |
| **Fix plan** | Add a `COMPLIANCE INVARIANT` comment to `app/api/sync/route.ts` documenting the consent-before-publish flow (or relax the test pattern to accept current documentation). |
| **PR** | PR-T2 |

---

### 6. entitlements-require.test.ts

| Field | Value |
|-------|-------|
| **Test** | PR gate: quota 429 must use x-opsmantik-quota-exceeded only (rate-limit separate) |
| **Failure** | `sync must have entitlements quota reject path` |
| **Stack** | `entitlements-require.test.ts` (line from TAP) |
| **Classification** | TEST_BUG |
| **Root cause** | Test expects sync route to contain `rejected_entitlements_quota` or equivalent. Quota enforcement moved to worker. |
| **Fix plan** | Update test to assert quota reject path exists in `app/api/workers/ingest/route.ts`, or assert sync route documents the async flow. |
| **PR** | PR-T3 |

---

### 7. gdpr-consent-gates.test.ts

| Field | Value |
|-------|-------|
| **Test** | validateSite before consentScopes, consentScopes before tryInsert |
| **Failure** | `tryInsert must exist` |
| **Stack** | `gdpr-consent-gates.test.ts` |
| **Classification** | TEST_BUG |
| **Root cause** | Test expects `tryInsert` in sync route. Sync uses publish instead. |
| **Fix plan** | Update to: validateSite before consentScopes, consentScopes before publishToQStash (or equivalent). |
| **PR** | PR-T2 |

---

### 8. primary-source.test.ts

| Field | Value |
|-------|-------|
| **Test** | Primary source is always scoped by site_id (tenant-safe) |
| **Failure** | `calls and sessions must both filter by site_id` |
| **Stack** | `primary-source.test.ts` |
| **Classification** | TEST_BUG |
| **Root cause** | Test counts `.eq('site_id', siteId)` occurrences; call path uses RPC `get_call_session_for_oci` with `p_site_id`, which is tenant-safe but not matched by the regex. |
| **Fix plan** | Extend test to also accept RPC parameter `p_site_id` or equivalent as tenant-scoping. Or relax pattern to count RPC param usage. |
| **PR** | PR-T4 |

---

### 9. revenue-kernel-gates.test.ts

| Field | Value |
|-------|-------|
| **Test** | PR gate: duplicate path returns 200 with x-opsmantik-dedup and MUST NOT publish |
| **Failure** | `duplicate response must set x-opsmantik-dedup` |
| **Stack** | `revenue-kernel-gates.test.ts:24:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Sync route does not handle duplicates inline; dedup happens in worker. No x-opsmantik-dedup in sync response. |
| **Fix plan** | Update test: assert duplicate handling in worker, or document that sync returns 202 and dedup is worker-side. |
| **PR** | PR-T5 |

---

### 10. revenue-kernel-gates.test.ts

| Field | Value |
|-------|-------|
| **Test** | PR gate: evaluation order Auth (validateSite) -> Rate limit -> Idempotency -> Quota -> Publish |
| **Failure** | `Rate limit before Idempotency` |
| **Stack** | `revenue-kernel-gates.test.ts:48:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Test expects idempotency before quota in sync route. Sync has: Auth → Rate limit → Consent → Publish. Idempotency is in worker. |
| **Fix plan** | Update test to assert sync order: Auth → Rate limit → Consent → Publish; worker order: Idempotency → Quota → Insert. |
| **PR** | PR-T5 |

---

### 11. revenue-kernel-gates.test.ts

| Field | Value |
|-------|-------|
| **Test** | PR gate: quota reject path does not publish or write fallback |
| **Failure** | `quota reject returns status rejected_quota` |
| **Stack** | `revenue-kernel-gates.test.ts:58:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Test expects sync route to have `rejected_quota` status. Quota reject is in worker. |
| **Fix plan** | Assert quota reject logic exists in worker. |
| **PR** | PR-T5 |

---

### 12. revenue-kernel-gates.test.ts

| Field | Value |
|-------|-------|
| **Test** | PR gate: quota reject sets x-opsmantik-quota-exceeded and not x-opsmantik-ratelimit |
| **Failure** | `quota reject block must exist` |
| **Stack** | `revenue-kernel-gates.test.ts:66:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Same as #11: quota block expected in sync, lives in worker. |
| **Fix plan** | Assert worker has quota reject block with x-opsmantik-quota-exceeded. |
| **PR** | PR-T5 |

---

### 13. revenue-kernel-gates.test.ts

| Field | Value |
|-------|-------|
| **Test** | PR gate: quota reject updates idempotency row billable=false |
| **Failure** | `quota reject must call updateIdempotencyBillableFalse before returning 429` |
| **Stack** | `revenue-kernel-gates.test.ts:78:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Test expects sync route to call updateIdempotencyBillableFalse. That call is in worker. |
| **Fix plan** | Assert worker calls updateIdempotencyBillableFalse on quota reject. |
| **PR** | PR-T5 |

---

### 14. revenue-kernel-gates.test.ts

| Field | Value |
|-------|-------|
| **Test** | PR gate: idempotency DB error must return 500 and MUST NOT publish |
| **Failure** | `idempotency error path must return status billing_gate_closed` |
| **Stack** | `revenue-kernel-gates.test.ts:93:10` |
| **Classification** | TEST_BUG |
| **Root cause** | Test expects sync route to handle idempotency DB errors. Idempotency runs in worker; sync does not see those errors. |
| **Fix plan** | Assert worker returns 500 / billing_gate_closed on idempotency DB error. |
| **PR** | PR-T5 |

---

## PR Plan

| PR | Scope | Description |
|----|-------|-------------|
| **PR-T1** | call-event-db-idempotency | Align tests with call-event v2 QStash flow: 23505 in worker, consent-before-publish. |
| **PR-T2** | compliance-freeze + gdpr-consent-gates | Replace tryInsert assertions with publish/consent flow; add COMPLIANCE INVARIANT comment to sync route. |
| **PR-T3** | entitlements-require | Move quota-path assertions from sync to worker. |
| **PR-T4** | primary-source | Broaden tenant-safety assertion to include RPC p_site_id. |
| **PR-T5** | revenue-kernel-gates | Update all PR-gate assertions to worker: dedup, evaluation order, quota reject, updateIdempotencyBillableFalse, idempotency error. |

---

## Recommended Order

1. **PR-T2** – Add COMPLIANCE INVARIANT comment (trivial, unblocks one test).
2. **PR-T4** – primary-source pattern relaxation (isolated).
3. **PR-T1** – call-event idempotency tests.
4. **PR-T3** – entitlements-require.
5. **PR-T5** – revenue-kernel-gates (largest, 6 tests).

---

## Notes

- **No production behavior changes.** All fixes are test updates or documentation comments.
- **Worker coverage:** Ensure `/api/workers/ingest/route.ts` is exercised by these tests (directly or via route source inspection) so the PR-gate invariants remain verified.
