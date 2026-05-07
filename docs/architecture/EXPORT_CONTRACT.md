---
status: active
---

# Export Contract (EXPORT_CONTRACT)

**Canonical export item shape and ACK routing**

**Google Ads script/API upload batch:** `offline_conversion_queue` only (`export-fetch.ts` → `export-build-queue.ts`). The `marketing_signals` table may still exist for hash/audit/recovery flows; it is **not** merged into the GET export payload. `call_funnel_projection` is an analytics/read-model surface, not the Google Ads upload row source for that route.

**Score semantics** (`lead_score` vs `stage_base_major` vs `truth_closure_score`): [CLOSED_SYSTEM_SCORE_CONTRACT.md](./CLOSED_SYSTEM_SCORE_CONTRACT.md).

> **Operational view:** [docs/operations/OCI_OPERATIONS_SNAPSHOT.md](../operations/OCI_OPERATIONS_SNAPSHOT.md)

---

## Null Policy

**No fallbacks for critical values.** Missing `conversionTime`, `value_cents`, or `currency` → skip row and log (`EXPORT_SKIP_MISSING_TIMESTAMP`, `EXPORT_SKIP_MISSING_VALUE_CENTS`, `EXPORT_SKIP_MISSING_CURRENCY`). No silent `now()` or `0`.

---

## Export Item Identity

Deterministic external_id: derived from `call_id + stage + policy_version`. ACK routing is clean; the same logical conversion always maps to the same external_id.

### orderId Collision

**Problem:** Two distinct conversions with same gclid + second-precision conversion_time → same orderId → Google dedup → silent undercount.

**Current formula:** `${clickId}_${prefix}_${sanitizedOccurredAt}_${deterministicSuffix}` slice(0,128).

**Mitigation:** deterministic hash suffix derived from row identity. See `lib/oci/build-order-id.ts` for the canonical implementation.

---

## Export Item Shape (GoogleAdsConversionItem)

| Field | Type | Description |
| ----- | ---- | ----------- |
| id | string | Queue/projection row id — idempotency / ACK |
| orderId | string | Google Ads dedup — same orderId → second upload ignored |
| gclid | string | Google Click ID |
| wbraid | string | iOS web conversions |
| gbraid | string | iOS app conversions |
| conversionName | string | Conversion action (e.g. "Sealed Lead") |
| conversionTime | string | yyyy-mm-dd HH:mm:ss±HH:mm |
| conversionValue | number | Numeric only |
| conversionCurrency | string | ISO (e.g. TRY) |
| hashed_phone_number? | string | SHA-256 hex — Enhanced Conversions |
| om_trace_uuid? | string | OM-TRACE-UUID forensic chain |

---

## READY Condition

`export_status = 'READY'` only when canonical `satis` completeness is reached.

---

## ACK Routing

When ACK is received, **journal** (`offline_conversion_queue`) rows are finalized. ACK may still accept legacy `signal_*` ids for older rows or separate paths. Projection mirrors update separately. Deterministic `external_id` keeps routing unambiguous.
