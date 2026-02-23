# Revenue Kernel — Master Freeze (draft)

**Date:** 2026-02-13  
**Status:** Draft / Frozen reference

---

## Purpose

In OpsMantik, the **single source of truth** for billable usage:

- **Invoice SoT** = BILLABLE rows in `ingest_idempotency` (`site_id` + month)
- Redis / events / sessions are **not** invoice authority.

---

## Invariants (never broken)

| Invariant | Description |
|-----------|-------------|
| **Billable Event = Idempotency insert success** | A billable unit is a row successfully inserted into the idempotency table. |
| **Duplicate → non-billable, no publish** | Duplicate request returns 200 + `x-opsmantik-dedup: 1`; no QStash publish, no invoice. |
| **Rate-limit 429 → non-billable, no idempotency insert** | Requests returning 429 do not write an idempotency row; no invoice. |
| **QStash fail → write to fallback buffer → billable (capture)** | If publish fails, write to `ingest_fallback_buffer`; invoice is cut **at capture time**, not at recovery. |
| **Redis is not SoT** | Invoice count remains correct even if Redis is reset; accounting is derived from Postgres only. |

---

## Data access rule

**Tenant must never UPDATE `ingest_idempotency.billable` or `billing_state`; only service_role / reconciliation job may write.**  
This rule mitigates the risk of "customer manipulated data" in dispute scenarios. Site members may read only their own site rows (dispute export); INSERT/UPDATE/DELETE belong exclusively to the API (service_role) and reconciliation cron.

---

## PR Dependency Graph

```
PR-1 (Schema) ──────────────────────────────────────────────────────────────┐
     │                                                                       │
     ├──► PR-3 (Quota) ─── soft/overage/cap behavior                        │
     ├──► PR-4 (Reconciliation) ─── monthly ledger fill + drift alarm        │
     ├──► PR-6 (Dispute export) ─── dispute outputs                          │
     └──► PR-7 (Dispute/export tool)                                         │
     │                                                                       │
PR-2 (Idempotency v2 + versioning) ─── duplicate/billing determinism         │
     │                                                                       │
PR-5 (Fallback recovery) ─── degraded capture + publish recovery             │
     │                                                                       │
PR-8 (Observability) ─── metrics + Watchtower                                │
```

- **PR-1 (Schema):** `site_plans`, `site_usage_monthly`, `invoice_snapshot`, `billing_state`, `ingest_idempotency` extensions → foundation for PR-3/4/6/7.
- **PR-2 (Idempotency v2):** Event-specific bucket, versioning → duplicate and billing determinism.
- **PR-3 (Quota):** Soft / overage / hard cap behavior.
- **PR-5 (Fallback recovery):** Degraded capture + recovery cron.
- **PR-4 (Reconciliation):** Monthly ledger fill + drift alarm.
- **PR-6 / PR-7 (Dispute export):** Dispute outputs (deterministic order, hash, CSV).
- **PR-8 (Observability):** Metrics + Watchtower integration.

---

## Idempotency v1 / v2 (PR-2)

| Version | Time bucket | Key format | Usage |
|---------|-------------|------------|-------|
| **v1** | Single 5s window | 64-char hex (no prefix) | Default; compatible with existing rows. |
| **v2** | Event-specific | `v2:<64-char hex>` | Enabled via `OPSMANTIK_IDEMPOTENCY_VERSION=2`. |

**v2 bucket rules:** heartbeat = 10s, page_view = 2s, click / call_intent = 0s (full timestamp ms). UNIQUE(site_id, idempotency_key) unchanged; version encoded via key prefix (`v2:`); existing invoice logic preserved.

**Security (v2):** For click and call_intent, idempotency time component uses **server time only** (`getServerNowMs()` / `serverNowMs` from route); client-supplied `ts`, `t`, `timestamp`, `created_at` etc. are **ignored**. This prevents clients from skewing time to bypass dedup and inflate invoice rows. For heartbeat/page_view, payload timestamp is used only if within ±5 minutes of server time; otherwise clamped to server time.

**Code:** v1 = `computeIdempotencyKey()` (unchanged); v2 = `computeIdempotencyKeyV2()`. Route selects which function to use via `OPSMANTIK_IDEMPOTENCY_VERSION` (default `"1"`). Rollout: set env to `2` for v2; rollback: set to `1` or unset.

## Rollout Strategy

- **PR-1 / PR-2:** Enable via feature flag.
- **PR-2:** `OPSMANTIK_IDEMPOTENCY_VERSION` env: `1` (default) = v1, `2` = v2. v1 retained; when v2 is enabled, new keys use `v2:<hash>`.
- **Invoice accounting:** From DB only (`ingest_idempotency` + reconciliation); Redis/events/sessions are not used.

---

## Rollback

- **Disable v2 → revert to v1:** Turn off idempotency v2 flag to restore v1 behavior.
- **Schema additive:** New tables/columns are not reverted; only new code paths (quota, v2 idempotency) are disabled.

---

## Related documents

- `REVENUE_KERNEL_SPEC.md` — Billable unit, quota, metering, failure modes.
- `REVENUE_KERNEL_ARCHITECTURE_AUDIT.md` — Architecture audit and frozen rules.
- `REVENUE_KERNEL_IMPLEMENTATION_EVIDENCE.md` — Implementation evidence, curl, Go/No-Go checklist.
