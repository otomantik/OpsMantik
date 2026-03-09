# Export Contract (EXPORT_CONTRACT)

**Projection-based export item shape ve ACK routing**

`USE_FUNNEL_PROJECTION=true` iken export tek kaynak: `call_funnel_projection`.

> **Operational view:** [docs/operations/OCI_OPERATIONS_SNAPSHOT.md](../operations/OCI_OPERATIONS_SNAPSHOT.md)

---

## Null Policy

**No fallbacks for critical values.** Missing `conversionTime`, `value_cents`, or `currency` → skip row and log (`EXPORT_SKIP_MISSING_TIMESTAMP`, `EXPORT_SKIP_MISSING_VALUE_CENTS`, `EXPORT_SKIP_MISSING_CURRENCY`). No silent `now()` or `0`.

---

## Export Item Identity

Deterministik external_id: `call_id + stage + policy_version` kombinasyonundan türetilir. ACK routing temiz; aynı logical conversion her zaman aynı external_id'ye map edilir.

### orderId Collision (Phase 21 / EXTINCTION DOSSIER)

**Problem:** İki farklı conversion aynı gclid + saniye hassasiyetli conversion_time → aynı orderId → Google dedupe → sessiz eksik sayım.

**Current formula:** `${clickId}_V5_SEAL_${sanitizedOccurredAt}` slice(0,128).

**Mitigation:** `call_id` veya `queue_id` suffix eklenebilir (128 char izin verirse). P2. Ayrıntı: `docs/runbooks/EXTINCTION_DOSSIER_ABYSSAL_AUDIT.md`.

---

## Export Item Shape (GoogleAdsConversionItem)

| Alan | Tip | Açıklama |
| ---- | --- | -------- |
| id | string | Queue/projection row id — idempotency / ACK |
| orderId | string | Google Ads dedupe — aynı orderId → ikinci upload ignore |
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

## READY Koşulu

`export_status = 'READY'` yalnızca `funnel_completeness = complete` iken mümkün.

---

## ACK Routing

ACK geldiğinde projection satırı güncellenir: `export_status = 'ACKED'`. Deterministik external_id sayesinde doğru satır bulunur.
