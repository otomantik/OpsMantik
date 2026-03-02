# OCI Logic Bugs & Hardening Plan (PR-OCI-4/5/6)

**Role:** Principal Backend Auditor, Adversarial Reviewer.  
**Goal:** Find logic bugs, revenue-impacting anomalies; propose minimal hardening.  
**Invariants:** ingest_idempotency = billing SoT; no UI/i18n changes.

---

## 1. Executive Summary — Top 5 Logic Bugs (by Severity)

| Rank | Bug | Severity | Consequence |
|------|-----|----------|-------------|
| 1 | **confirm_sale_and_enqueue RPC** inserts `value_cents: v_sale.amount_cents` with **no 0 TL check** | **CRITICAL** | 0 TL sales reach queue → export/runner send 0 to Google |
| 2 | **Export** uses `Number(row.value_cents) \|\| 0` — null/undefined become 0 and are **sent** | **CRITICAL** | Legacy rows with null value_cents → 0 sent to Google |
| 3 | **Runner** filters only `value_cents == null \|\| value_cents === undefined`; **value_cents === 0 is NOT filtered** | **CRITICAL** | 0 TL rows are uploaded to Google |
| 4 | **Frontend does NOT send `version`** on seal; optimistic lock is skipped | **HIGH** | Concurrent 60/80/100 all succeed; last-write-wins; duplicate audit entries |
| 5 | **marketing_signals PENDING** never auto-cleared; script path has no DLQ | **HIGH** | PENDING signals stuck forever if script never acks; re-export risk |

---

## 2. Evidence Table

| Bug | File | Exact snippet | Consequence |
|-----|------|---------------|-------------|
| confirm_sale RPC inserts 0 TL | `supabase/migrations/20260226000005_confirm_sale_marketing_consent.sql` L33-36 | `INSERT INTO ... value_cents, ... VALUES (..., v_sale.amount_cents, ...)` — no check for `amount_cents > 0` | Sale with amount_cents 0 or null → queue row with 0 → sent to Google |
| Export coerces null → 0 | `app/api/oci/google-ads-export/route.ts` L387 | `const valueCents = Number(row.value_cents) \|\| 0;` | Legacy row with null value_cents → 0 sent |
| Runner does not filter 0 | `lib/oci/runner.ts` L561-568 | `if (v == null \|\| v === undefined) { ... return false; }` — no `v <= 0` | Rows with value_cents 0 pass filter and are uploaded |
| Version not sent | `lib/hooks/use-queue-controller.ts` L511-514 | `body: JSON.stringify({ sale_amount, currency, lead_score })` — no `version` | p_version always null → optimistic lock skipped |
| Version not sent | `lib/hooks/use-intent-qualification.ts` L112-121 | `body: JSON.stringify({ lead_score, currency: 'TRY' })` — no `version` | Same |
| PENDING → SENT only via ack | `app/api/oci/ack/route.ts` L168-177 | `marketing_signals.update({ dispatch_status: 'SENT' })` | If script never calls ack, PENDING forever |
| Export always returns PENDING | `app/api/oci/google-ads-export/route.ts` L175 | `.eq('dispatch_status', 'PENDING')` | Same PENDING rows re-exported every run |

---

## 3. TASK A — 0 TL LEAK MAP

### Producers of offline_conversion_queue rows

| Producer | File | value_cents source | Can insert ≤ 0? |
|----------|------|--------------------|-----------------|
| **Seal path** | `lib/oci/enqueue-seal-conversion.ts` L153-166 | `computeConversionValue(star, saleAmount, config)`; returns null for 0/null/negative → no insert | **NO** |
| **Sweep** | `app/api/cron/sweep-unsent-conversions/route.ts` | Calls `enqueueSealConversion` | **NO** (same as seal) |
| **enqueue-from-sales** | `app/api/cron/oci/enqueue-from-sales/route.ts` L93-97 | `valueCents = sale.amount_cents ?? 0`; `if (valueCents <= 0) skip` | **NO** (fixed) |
| **pipeline-service** | `lib/services/pipeline-service.ts` L52, 86, 130 | `finalValueCents = customAmountCents ?? stage.value_cents`; `if (isJunk \|\| finalValueCents === 0) return` | **NO** (0 blocked; negative could pass — edge case) |
| **confirm_sale_and_enqueue RPC** | `supabase/migrations/20260226000005_confirm_sale_marketing_consent.sql` L33-36 | `value_cents: v_sale.amount_cents` — **no check** | **YES — CRITICAL** |

### Export & runner treatment

| Path | Filter ≤ 0? | Coerce null → 0? | Sends 0 to Google? |
|------|-------------|------------------|---------------------|
| **Export** (`google-ads-export/route.ts`) | **NO** | **YES** (`Number(x)\|\|0`) | **YES** |
| **Runner** (`lib/oci/runner.ts`) | **NO** (only null/undefined) | N/A (skips null) | **YES** (0 passes filter) |

### 0 TL Leak Map (file paths + snippets)

```
PRODUCER LEAKS:
├── supabase/migrations/20260226000005_confirm_sale_marketing_consent.sql:33-36
│   INSERT ... value_cents = v_sale.amount_cents  ← NO CHECK
│   → Sale with amount_cents 0 → row inserted → exported/uploaded
│
CONSUMER LEAKS:
├── app/api/oci/google-ads-export/route.ts:387
│   valueCents = Number(row.value_cents) || 0  ← null→0, 0→0, BOTH SENT
│
├── lib/oci/runner.ts:561-568
│   if (v == null || v === undefined) return false  ← 0 PASSES
│   → value_cents === 0 → uploaded to Google
```

---

## 4. PR-OCI-4 — Defense-in-Depth Hardening (0 TL Never Reaches Google)

### Acceptance criteria

- No offline_conversion_queue row with value_cents <= 0 is ever uploaded to Google.
- Export and runner must fail-closed: skip send for value_cents <= 0.
- Blocked rows: mark FAILED with last_error='VALUE_ZERO', provider_error_code='VALUE_ZERO', provider_error_category='PERMANENT'.
- Structured log: `OCI_ROW_SKIP_VALUE_ZERO` with queue_id, value_cents, prefix.

### Patch list

| # | File | Change |
|---|------|--------|
| 1 | `supabase/migrations/YYYYMMDD_confirm_sale_skip_zero_value.sql` | In confirm_sale_and_enqueue: before INSERT, `IF v_sale.amount_cents IS NULL OR v_sale.amount_cents <= 0 THEN ... (skip insert, RETURN enqueued=false)` |
| 2 | `app/api/oci/google-ads-export/route.ts` | Filter queue rows: `if ((Number(row.value_cents) ?? 0) <= 0) continue` (skip from conversions list); log `OCI_EXPORT_SKIP_VALUE_ZERO` with queue_id |
| 3 | `lib/oci/runner.ts` | Extend rowsWithValue filter: `if (v == null \|\| v === undefined \|\| typeof v !== 'number' \|\| v <= 0) { logWarn('OCI_ROW_SKIP_VALUE_ZERO', ...); return false; }`; for filtered rows: bulkUpdateQueue status=FAILED, last_error='VALUE_ZERO', provider_error_code='VALUE_ZERO', provider_error_category='PERMANENT' |
| 4 | `lib/services/pipeline-service.ts` | Harden: `if (isJunk \|\| finalValueCents == null \|\| !Number.isFinite(finalValueCents) \|\| finalValueCents <= 0) return` |

### Status for blocked rows

**Choice: FAILED with VALUE_ZERO**

- **Rationale:** 0 TL conversions are invalid per policy; they must not retry. Marking COMPLETED would imply "successfully sent"; FAILED with explicit reason is correct. `provider_error_code='VALUE_ZERO'` allows reporting and filtering.
- **Alternative rejected:** COMPLETED + skipped flag — would require schema change and would conflate "sent" with "blocked."

### Unit tests

| Test file | Assertion |
|-----------|-----------|
| `tests/unit/oci-value-zero-guard.test.ts` | Export: row with value_cents 0 not in output; log called |
| `tests/unit/oci-value-zero-guard.test.ts` | Runner: rowsWithValue filter excludes value_cents 0; filtered rows updated to FAILED with VALUE_ZERO |
| `tests/unit/oci-value-zero-guard.test.ts` | confirm_sale: when amount_cents 0, RPC returns enqueued=false; no queue insert (source inspection or mock) |
| `tests/unit/oci-value-zero-guard.test.ts` | pipeline-service: finalValueCents <= 0 returns without insert |

---

## 5. TASK C — marketing_signals PENDING Forever (PR-OCI-5)

### How PENDING → SENT/FAILED

- **PENDING → SENT:** POST /api/oci/ack with `queueIds` containing `signal_<uuid>`. RPC updates marketing_signals SET dispatch_status='SENT', google_sent_at=NOW WHERE id IN (...) AND dispatch_status='PENDING'.
- **PENDING → FAILED:** No automatic path. ack-failed can mark queue rows FAILED; marketing_signals have no equivalent.

### Can PENDING remain forever?

**Yes.** If script never calls ack (crash, bug, misconfiguration), PENDING signals are re-exported every export run. Order_id is deterministic, so Google dedupes; but PENDING stays in DB indefinitely. No DLQ, no auto-expire.

### Mitigation (PR-OCI-5)

**Option chosen: Cron cleanup for PENDING older than X days** (no new tables)

- Add to cleanup cron: `UPDATE marketing_signals SET dispatch_status='FAILED' WHERE dispatch_status='PENDING' AND created_at < now() - interval '30 days'` (batch with limit).
- Export already filters on `dispatch_status='PENDING'`; FAILED rows are excluded. marketing_signals has no provider_error_code column — just set FAILED.
- **Justification:** Simple; no schema change; 30 days gives enough time for script to ack. Stale PENDING = likely script never acks.
- **Alternative rejected:** exported_at column — requires schema change.

### Acceptance criteria

- Cron marks PENDING rows older than 30 days as FAILED with provider_error_code='PENDING_STALE'.
- Export does not return FAILED rows (already filtered by PENDING).
- Unit test: cleanup logic includes PENDING_STALE branch; source inspection or integration test.

### Patch list

| # | File | Change |
|---|------|--------|
| 1 | `app/api/cron/cleanup/route.ts` (or new cron) | Add phase: UPDATE marketing_signals SET dispatch_status='FAILED' WHERE dispatch_status='PENDING' AND created_at < cutoff; limit batch |
| 2 | — | marketing_signals has no provider_error_code; use dispatch_status='FAILED' only |
| 3 | `tests/unit/oci-pending-stale.test.ts` | Assert cleanup updates PENDING older than 30d |

---

## 6. TASK D — Versioned Seal Race (PR-OCI-6)

### Frontend sends version?

**No.** `use-queue-controller.ts` and `use-intent-qualification.ts` do not include `version` in the seal request body. Seal route: `const version = body.version != null ? Number(body.version) : null` → always null. Optimistic lock: `IF p_version IS NOT NULL AND v_call.version IS DISTINCT FROM p_version` → check skipped. **Risk:** Concurrent 60/80/100 all succeed; last-write-wins.

### Server-side enforcement

**Option chosen: Fetch call.version server-side and pass to RPC**

- Seal route already fetches call: `adminClient.from('calls').select('id, site_id, version, created_at')`. Use `call.version` and pass to RPC even when body.version is missing: `p_version: version ?? call.version`.
- **Effect:** If client omits version, we use DB version. Concurrent requests: first wins, second gets P0002 (version mismatch) → 409.
- **No UI change.** No 400 for missing version (backward compat).

### Minimal change

| File | Change |
|------|--------|
| `app/api/calls/[id]/seal/route.ts` L128 | `p_version: version ?? (call as { version?: number }).version ?? null` — use body version if provided, else DB version from fetch |

### Unit test

| Test file | Assertion |
|-----------|-----------|
| `tests/unit/seal-version-enforcement.test.ts` | Seal route passes call.version to RPC when body.version is missing (source inspection) |
| `tests/unit/seal-version-enforcement.test.ts` | Concurrent seal with same version → one 200, one 409 (integration if possible) |

---

## 7. PR Plan Summary

| PR | Scope | Acceptance criteria |
|----|-------|---------------------|
| **PR-OCI-4** | 0 TL defense-in-depth | confirm_sale skip 0; export filter ≤0; runner filter ≤0 + mark FAILED; pipeline-service harden; unit tests |
| **PR-OCI-5** | PENDING stale cleanup | Cron marks PENDING >30d as FAILED; tests |
| **PR-OCI-6** | Versioned seal | Seal route passes call.version when body.version missing; tests |

---

## 8. Test Plan

| Test file | Assertions |
|-----------|------------|
| `tests/unit/oci-value-zero-guard.test.ts` | Export excludes value_cents ≤ 0; Runner excludes value_cents ≤ 0 and marks FAILED; confirm_sale skips amount_cents ≤ 0; pipeline-service rejects ≤ 0 |
| `tests/unit/oci-pending-stale.test.ts` | Cleanup updates PENDING >30d to FAILED |
| `tests/unit/seal-version-enforcement.test.ts` | Seal route uses call.version when body.version absent; RPC receives p_version |
