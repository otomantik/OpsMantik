# Funnel Kernel Contract (FUNNEL_CONTRACT)

**OpsMantik Funnel Kernel Charter v2 — immutable semantics**

This document defines the kernel ontology and red lines. The application is developed according to this contract.

> **Operational view:** [docs/operations/OCI_OPERATIONS_SNAPSHOT.md](../operations/OCI_OPERATIONS_SNAPSHOT.md)  
> **OCI value engines + SSOT:** [OCI_VALUE_ENGINES_SSOT.md](./OCI_VALUE_ENGINES_SSOT.md)

---

## Strategic Decision: V1/V2 Outside Kernel

| Layer | Scope | Description |
| ----- | ----- | ----------- |
| **Observability Layer** | V1/V2 historical residue | Traffic telemetry or archived ingress artifacts. Not canonical export ontology. |
| **Funnel Kernel** | `junk`, `gorusuldu`, `teklif`, `satis` | Revenue ontology. call_id required. |

Legacy V1/V2 artifacts are not part of the kernel. Canonical runtime only reasons about `junk`, `gorusuldu`, `teklif`, `satis`.

---

## Stage Semantics

| Stage | Name | Description | Value |
| ----- | ---- | ----------- | ----- |
| `junk` | Cop | Exclusion / audience-only signal | `0.1 × quality_factor` |
| `gorusuldu` | Gorusuldu | Qualified conversation | `10 × quality_factor` |
| `teklif` | Teklif | Proposal / hot intent | `50 × quality_factor` |
| `satis` | Satis | Closed sale | `100 × quality_factor` |

| Field | Range |
| ----- | ----- |
| stage | `junk`, `gorusuldu`, `teklif`, `satis` |
| quality_score | 1..5 (merchant score) |
| confidence | 0..1 (attribution confidence) |

---

## Event Type Dictionary (Canonical)

| event_type | Description |
| ---------- | ----------- |
| `junk` | Canonical junk / exclusion event |
| `gorusuldu` | Canonical qualified conversation |
| `teklif` | Canonical proposal / hot intent |
| `satis` | Canonical sale |
| REPAIR_ATTEMPTED | Repair attempted |
| REPAIR_COMPLETED | Repair completed |
| REPAIR_FAILED | Repair failed |

---

## Funnel Kernel Red Lines

| Rule | Description |
| ---- | ----------- |
| Routes must not write to projection directly | Only ledger-writer + projection-updater write |
| Google OCI export SSOT | Queue + `marketing_signals`; see [OCI_VALUE_ENGINES_SSOT.md](./OCI_VALUE_ENGINES_SSOT.md). Projection is for analytics / metrics, not primary OCI batch. |
| No READY without `satis` completeness | `funnel_completeness = complete` required |
| Repair cannot replace normal flow | Exception mechanism; monitored with KPI |
| Historical residues must not be invisible | archived/historical rows may exist but do not drive canonical export |
| Ad-hoc value calculation outside policy forbidden | Single SSOT: `optimization-contract.ts` |
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

If `satis` exists in projection, `funnel_completeness = complete`; otherwise repair worker or BLOCKED.
