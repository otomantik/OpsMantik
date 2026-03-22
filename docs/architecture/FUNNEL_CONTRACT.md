# Funnel Kernel Contract (FUNNEL_CONTRACT)

**OpsMantik Funnel Kernel Charter v1 — immutable semantics**

This document defines the kernel ontology and red lines. The application is developed according to this contract.

> **Operational view:** [docs/operations/OCI_OPERATIONS_SNAPSHOT.md](../operations/OCI_OPERATIONS_SNAPSHOT.md)  
> **OCI value engines + SSOT (V2–V5, queue vs projection):** [OCI_VALUE_ENGINES_SSOT.md](./OCI_VALUE_ENGINES_SSOT.md)

---

## Strategic Decision: V1 Outside Kernel

| Layer | Scope | Description |
| ----- | ----- | ----------- |
| **Observability Layer** | V1 (PAGEVIEW) | Redis volume, visibility, traffic telemetry. Not call_id-centric. |
| **Funnel Kernel** | V2–V5 | Revenue ontology. call_id required. |

V1 is not part of the kernel. Pageview is not forced to call_id.

---

## Stage Semantics

| Stage | Name | Description | Value |
| ----- | ---- | ----------- | ----- |
| V2 | PULSE | First contact | AOV×2% soft decay |
| V3 | ENGAGE | Qualified contact | AOV×10% standard decay |
| V4 | INTENT | Hot intent | AOV×30% aggressive decay |
| V5 | SEAL | Iron seal | exact value_cents, no decay |

| Field | Range |
| ----- | ----- |
| stage | V2, V3, V4, V5 |
| quality_score | 1..5 (merchant score) |
| confidence | 0..1 (attribution confidence) |

---

## Event Type Dictionary (Canonical)

| event_type | Description |
| ---------- | ----------- |
| V2_CONTACT | Real V2 contact |
| V2_SYNTHETIC | V2 completed via repair |
| V3_QUALIFIED | V3 qualified contact |
| V4_INTENT | V4 hot intent |
| V5_SEALED | Sealed sale |
| REPAIR_ATTEMPTED | Repair attempted |
| REPAIR_COMPLETED | Repair completed |
| REPAIR_FAILED | Repair failed |

---

## Funnel Kernel Red Lines

| Rule | Description |
| ---- | ----------- |
| Routes must not write to projection directly | Only ledger-writer + projection-updater write |
| Google OCI export SSOT | Queue + `marketing_signals`; see [OCI_VALUE_ENGINES_SSOT.md](./OCI_VALUE_ENGINES_SSOT.md). Projection is for analytics / metrics, not primary OCI batch. |
| No READY without V5 completeness | funnel_completeness = complete required |
| Repair cannot replace normal flow | Exception mechanism; monitored with KPI |
| Synthetic stages must not be invisible | v2_source, synthetic_flags_json in projection |
| Ad-hoc value calculation outside policy forbidden | Single SSOT: value-config + policy |
| New imports from legacy utils forbidden | mizan-mantik, predictive-engine deprecated |
| Reducer must not deviate from deterministic order | ORDER BY fixed; immutable |

---

## Tenant Security: site_id × call_id

If the given `call_id` does not match the given `site_id`, event append must fail. Append path must validate `calls.site_id = site_id`.

---

## Terminal States and Void Cascade (Phase 32)

| Item | Semantics |
|------|-----------|
| JUNK / CANCELLED | Cannot be sealed. State machine lockdown. Document in EXPORT_CONTRACT: terminal states. |
| void_pending_oci_queue_on_call_reversal | VOIDs QUEUED/RETRY when call junked/cancelled/restored. Trigger fires on calls.status UPDATE; voided rows excluded from export. |
| Undo / restore | undo_last_action_v1, revert_snapshot: undo appends to call_actions; revert_snapshot stores pre-update state. |
| Restore from junk | restore → intent; void_pending triggers. |

---

## Immutability Contract (Phase 33)

| Table | Semantics |
|-------|-----------|
| marketing_signals | Append-only; only dispatch_status, google_sent_at updatable. |
| call_funnel_ledger | Append-only. |
| invoice_snapshot, revenue_snapshots | Immutable (no UPDATE/DELETE). |
| call_actions | Append-only audit trail; revert_snapshot for undo. |
| offline_conversion_queue | Immutable after COMPLETED/FAILED. |

---

## Invariant

If V5 exists in projection, `funnel_completeness = complete`; otherwise repair worker or BLOCKED.
