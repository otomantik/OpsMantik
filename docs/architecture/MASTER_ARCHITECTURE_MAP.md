# OpsMantik Master Architecture Map

**Single-page architecture map** — entire system in one diagram.

---

## Master Flow

```mermaid
flowchart TB
    subgraph Ingress["1. Ingress"]
        A1[POST /api/sync]
        A2[POST /api/call-event]
        A3[POST /api/track/pv]
    end

    subgraph Identity["2. Identity Stitch"]
        B1[sessions]
        B2[matched_fingerprint]
        B3[get_call_session_for_oci]
        B1 --> B2
        B2 --> B3
    end

    subgraph Funnel["3. Funnel Kernel"]
        C1[call_funnel_ledger]
        C2[call_funnel_projection]
        C3[funnel_policy / value_formula]
        C1 --> C2
        C3 --> C1
    end

    subgraph Projection["4. Projection"]
        D1[export_status: READY/BLOCKED]
        D2[ledger_writer / projection_updater]
        D2 --> D1
    end

    subgraph Export["5. Export"]
        E1[GET /api/oci/google-ads-export]
        E2[Script / Runner]
        E3[Google Ads API]
        E1 --> E2 --> E3
    end

    subgraph Recovery["6. Recovery"]
        F1[sweep-zombies]
        F2[recover-stuck-signals]
        F3[recover_stuck_offline_conversion_jobs]
    end

    subgraph Policy["7. Policy Engine"]
        G1[V1–V5 gears]
        G2[computeConversionValue]
        G3[value-formula SSOT]
    end

    Ingress --> Identity
    Ingress --> Funnel
    Identity --> Export
    Funnel --> Projection --> Export
    Export -.-> Recovery
    Policy --> Funnel
    Policy --> Export
```

---

## Component Summary

| # | Component | Description |
|---|------------|-------------|
| 1 | **Ingress** | sync (events), call-event (intent), track/pv (pageview) |
| 2 | **Identity Stitch** | session → fingerprint, call → matched_session, GCLID resolution |
| 3 | **Funnel Kernel** | ledger (append-only), projection (funnel metrics / readiness), policy/weights |
| 4 | **Projection** | export_status READY/BLOCKED (kernel); **not** the `google-ads-export` batch table source |
| 5 | **Export** | `google-ads-export` → journal rows; Script or Runner uploads to Google Ads |
| 6 | **Recovery** | sweep-zombies (10 min), recover-stuck-signals (4 hr), queue recover |
| 7 | **Policy Engine** | V1–V5, value formula, floor/decay |

---

## Legacy vs Target

| Path | Components | Status |
|-----|------------|-------|
| **Target** | Ingress → ledger → projection → Export | SHADOW MODE |
| **Legacy planes** | `marketing_signals` + Redis V1 (not in script GET); **`offline_conversion_queue` → Google script export** | ACTIVE |

---

**Reference:** [Platform Overview](../overview/PLATFORM_OVERVIEW.md) | [OCI Operations Snapshot](../operations/OCI_OPERATIONS_SNAPSHOT.md)
