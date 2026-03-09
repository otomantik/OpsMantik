# Export Contract (EXPORT_CONTRACT)

**Projection-based export item shape ve ACK routing**

`USE_FUNNEL_PROJECTION=true` iken export tek kaynak: `call_funnel_projection`.

---

## Export Item Identity

Deterministik external_id: `call_id + stage + policy_version` kombinasyonundan türetilir. ACK routing temiz; aynı logical conversion her zaman aynı external_id'ye map edilir.

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
