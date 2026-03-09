# Export Contract (EXPORT_CONTRACT)

**Projection-based export item shape and ACK routing**

When `USE_FUNNEL_PROJECTION=true`, export single source is `call_funnel_projection`.

> **Operational view:** [docs/operations/OCI_OPERATIONS_SNAPSHOT.md](../operations/OCI_OPERATIONS_SNAPSHOT.md)

---

## Null Policy

**No fallbacks for critical values.** Missing `conversionTime`, `value_cents`, or `currency` → skip row and log (`EXPORT_SKIP_MISSING_TIMESTAMP`, `EXPORT_SKIP_MISSING_VALUE_CENTS`, `EXPORT_SKIP_MISSING_CURRENCY`). No silent `now()` or `0`.

---

## Export Item Identity

Deterministic external_id: derived from `call_id + stage + policy_version`. ACK routing is clean; the same logical conversion always maps to the same external_id.

### orderId Collision (Phase 21 / EXTINCTION DOSSIER)

**Problem:** Two distinct conversions with same gclid + second-precision conversion_time → same orderId → Google dedup → silent undercount.

**Current formula:** `${clickId}_V5_SEAL_${sanitizedOccurredAt}` slice(0,128).

**Mitigation:** `call_id` or `queue_id` suffix can be added (if 128 char allows). P2. Details: `docs/runbooks/EXTINCTION_DOSSIER_ABYSSAL_AUDIT.md`.

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

`export_status = 'READY'` only when `funnel_completeness = complete`.

---

## ACK Routing

When ACK is received, projection row is updated: `export_status = 'ACKED'`. Deterministic external_id ensures the correct row is found.
