# Attribution Forensic Layer

When a conversion fails to sync or match, the system can produce a **Causal Failure Trace** instead of only "GCLID Not Found". This document describes the Diagnostic Attribution Engine and the forensic export.

## RPC: `get_attribution_forensic_export_for_call(call_id, site_id)`

Returns one row per call with DIC baseline fields plus **Shadow Metadata** and **Signal Quality Indicators** for diagnostics.

### 1. Signal Integrity Matrix

| Field | Description |
|-------|-------------|
| **identity_resolution_score** | 0–1: how "clean" the phone number is (10–15 digits → 1.0, 7+ digits → 0.5, else 0.3). Used to infer VOIP vs verified mobile likelihood. |
| **touchpoint_entropy** | JSONB array of `{ user_agent, ip_address, created_at }` for all sessions with the same fingerprint in the **last 14 days**. Use to see if Privacy Sandbox / GPC or VPN might have suppressed the GCLID. |

### 2. Shadow Attribution Chain

| Field | Description |
|-------|-------------|
| **cross_device_fingerprint_link** | If fingerprint or environment changed in 14 days: `multiple_fingerprints` (same phone, different fingerprints), `ip_change`, or `browser_update`. NULL if stable. |
| **pre_normalization_snapshot** | JSONB `{ raw_phone_string, raw_user_agent }`: the rawest PII before any cleaning. Use to check if sanitization is over-filtering valid data. |

### 3. Failure Mode Categorization

**failure_mode** assigns each no-match to a Deep-Forensic bucket:

| Bucket | Meaning |
|--------|--------|
| **ORPHANED_CONVERSION** | Phone verified but no fingerprint match in lookback (or matched_fingerprint is NULL). High probability offline/direct origin. |
| **SIGNAL_STALE** | Identity found but first touch is older than **30 days** (Google attribution window). |
| **HASH_MISMATCH** | Not set by DB; reserved for pipeline/app when encoding/charset collision is detected between DB and SHA256 output. Implemented in Node only: `scripts/tests/forensic-smoke-test.mjs` recomputes hash from `caller_phone_e164` with `OCI_PHONE_HASH_SALT` and compares to stored `caller_phone_hash_sha256`. |
| **ATTRIBUTION_HIJACK** | Not set by DB; reserved for when a newer Organic/Direct touchpoint after the Paid click lowers weight below threshold. |

### 4. Environmental Context

| Field | Description |
|-------|-------------|
| **clids_discarded_count** | Count of FAILED queue rows for this call where `provider_error_code` is `INVALID_GCLID` / `UNPARSEABLE_GCLID` or `last_error` contains decode/GCLID/çözülemedi. Indicates whether campaign setup is "leaking" malformed click IDs. |

## Goal

Build a system that doesn’t just say *"GCLID Not Found"*. It can output:

> *"Conversion orphaned because Signal Integrity was low (identity_resolution_score &lt; 0.5) and Touchpoint Entropy was high (multiple IPs/UAs), shifting fallback to SHA256-Phone Match."*

## Usage

- Call `get_attribution_forensic_export_for_call(p_call_id, p_site_id)` from service_role after a failed sync or when analyzing no-match conversions.
- Combine with `get_dic_export_for_call` if you only need DIC fields; the forensic RPC includes the same DIC baseline plus the extra forensic columns.
- Use `pre_normalization_snapshot` and `touchpoint_entropy` to debug over-filtering or Privacy Sandbox impact; use `clids_discarded_count` to spot repeated invalid GCLID uploads for the same conversion.

## Salt Invalidation

Changing `OCI_PHONE_HASH_SALT` invalidates existing `caller_phone_hash_sha256` values for Google EC. Because `caller_phone_e164` is stored, hashes can be recomputed in a batch job after a salt change.

## Related

- DIC export: `get_dic_export_for_call`, `get_redundant_identities`
- UTF-8 / hashing: `docs/OPS/DIC_ECL_UTF8_ENCODING.md`
- Queue errors: `offline_conversion_queue.provider_error_code`, `last_error`
