# OpsMantik — Global SaaS Roadmap Analysis

**Date:** 2026-02-22  
**Scope:** Full system scan — payment channel, pricing, partitioning, type safety, SaaS score.

---

## 1. Current SaaS Score

| Metric | Score | Source |
|--------|-------|--------|
| **Global SaaS** | **62/100** | archive/root-legacy/SAAS_PUAN_RAPORU.md |
| **Turkey SaaS** | **59/100** | archive/root-legacy/SAAS_PUAN_RAPORU.md |
| **Product score** | **70/100** | archive/root-legacy/OPSMANTIK_URUN_PAZAR_RAPORU.md |
| **Engine / technical** | **~80/100** | archive/OPS-legacy/SYSTEM_SCAN_URUNE_GIDEN_YOL.md |

**Note:** i18n EN/TR/IT complete; Consent (sync gate, call-event gate, CMP sniffer, sessions/events consent_at+consent_scopes) implemented. SAAS_PUAN_RAPORU predates these updates; actual score may be slightly higher.

---

## 2. Payment Channel and Pricing Plan

### 2.1 Status

| Item | Present? | Description |
|------|----------|-------------|
| Stripe / payment gateway | ❌ | No payment integration |
| Pricing page (UI) | ❌ | No /pricing or equivalent |
| Checkout / subscription flow | ❌ | User cannot self-serve plan purchase |
| site_plans table | ✅ | plan_tier, monthly_limit, soft_limit_enabled |
| Quota / limit engine | ✅ | lib/quota.ts — getSitePlan, evaluateQuota |
| Invoice authority | ✅ | ingest_idempotency (billable), invoice_snapshot, dispute export |

### 2.2 Required Work

1. **Pricing plan definitions** — Free / Starter / Pro / Enterprise tiers, limits, prices (TRY/USD).
2. **Stripe (or equivalent) integration** — Checkout Session, Subscription, webhook.
3. **Pricing page** — `/pricing` or in-dashboard plan selection.
4. **Plan change flow** — When user selects plan: Stripe → webhook → site_plans update.
5. **Invoice email / PDF** — Invoice derived from invoice_snapshot (optional; Stripe invoicing may be used).

---

## 3. Partitioning

### 3.1 Current Status

| Table | Partition | Status | Criticality |
|-------|-----------|--------|-------------|
| **sessions** | Monthly RANGE (created_month) | ✅ | create_next_month_partitions(), pg_cron |
| **events** | Monthly RANGE (session_month) | ✅ | Same function |
| **ingest_idempotency** | None | ❌ | ~10–20M rows/month breaking point |

### 3.2 Ingest Partition (PR-9)

- **Document:** docs/architecture/OPS/SCALING_INGEST_IDEMPOTENCY.md  
- **When:** ingest_idempotency > ~5–10M rows or reconciliation/cleanup slows  
- **Migration:** 20260217000000_pr9_ingest_idempotency_partitioning.sql (planned; may not be applied)  
- **Alternative:** BRIN index (lighter, no migration)

---

## 4. Type Safety

### 4.1 Status

| Metric | Score | Description |
|--------|-------|-------------|
| **Type safety** | **100/100** | PR-C1 completed |
| `any` / `as any` (app/lib/components) | 0 | Removed from critical paths |
| no-explicit-any | Warn enabled | New `any` usage blocked |

**Conclusion:** Type safety meets global SaaS requirements.

---

## 5. Completed / Strong Areas

- **Multi-tenancy:** RLS, site_id scope, CORS fail-closed  
- **Revenue Kernel:** ingest_idempotency SoT, reconciliation, invoice freeze, dispute export  
- **Consent (GDPR/KVKK):** Sync consent gate (204 if analytics missing), call-event analytics gate, sessions/events consent_at+consent_scopes, CMP sniffer (Cookiebot, TCF 2.0, OneTrust), OCI enqueue marketing check  
- **Security:** Auth, vault, rate limit, quota, cron auth  
- **OCI (Google Ads):** Worker, vault, claim, upload pipeline  
- **Dashboard:** WAR ROOM, session/event/call, activity, KPI  
- **i18n:** EN, TR, IT (LocaleSwitcher, dictionaries)  
- **Partitioning:** sessions/events monthly partition  
- **Type safety:** PR-C1 completed  

---

## 6. Gaps for Global SaaS (Priority Order)

| Priority | Gap | Impact | Est. effort |
|----------|-----|--------|-------------|
| **P0** | Payment channel (Stripe) + Pricing page | Cannot charge | 2–3 weeks |
| **P0** | Pricing plan definitions (Free/Starter/Pro) | No plan sales | 1 week |
| ~~P1~~ | ~~Consent~~ | **✅ Done** | Sync consent gate, call-event consent gate, sessions/events consent_at+consent_scopes, CMP sniffer |
| **P1** | Right-to-erasure endpoint | GDPR mandatory | 3–5 days |
| **P2** | ingest_idempotency partition (PR-9) | Scale break | Per runbook |
| **P2** | Audit log (critical ops) | Operational maturity | G5 current draft |
| **P3** | DPA / data processing agreement | Enterprise customers | Document-focused |

---

## 7. Score Improvement Target

| Target | Global SaaS | Turkey SaaS | Steps |
|--------|-------------|-------------|-------|
| **Current** | 62 | 59 | — |
| **+Payment +Pricing** | ~68 | ~65 | Stripe + pricing UI |
| **+Erasure (Consent done)** | ~72 | ~70 | Right-to-erasure endpoint |
| **+PR-9 partition** | ~78 | ~75 | Scale assurance |

---

## 8. Summary

- **SaaS score:** Global 62/100, Turkey 59/100.  
- **Payment / pricing:** Backend (site_plans, quota) ready; no Stripe or pricing page.  
- **Partitioning:** sessions/events complete; ingest_idempotency PR-9 planned, not yet applied.  
- **Type safety:** PR-C1 at 100/100; sufficient for global SaaS.  
- **Critical next step:** Payment channel + pricing plan + self-serve checkout. Product cannot be marketed as "global SaaS" until this is complete.
