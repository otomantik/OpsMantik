# Revenue Kernel — Architecture Audit & Freeze

**Tarih:** 13 Şubat 2026  
**Amaç:** Revenue Kernel mimarisini doğrulamak, yarış koşullarını ve invaryantları kilitlemek, Go/No-Go kararı için tablo sunmak.

---

## 1. Architecture Diagram (Text)

```
                    ┌─────────────────────────────────────────────────────────────────┐
                    │                        POST /api/sync                             │
                    └─────────────────────────────────────────────────────────────────┘
                                                │
                    ┌───────────────────────────▼───────────────────────────┐
                    │ 1. AUTH (CORS + Site Resolution)                        │
                    │    • Origin allowed? → 403 if not                       │
                    │    • body.s → SiteService.validateSite() → site_id     │
                    │    • 400 if site invalid                               │
                    └───────────────────────────┬───────────────────────────┘
                                                │
                    ┌───────────────────────────▼───────────────────────────┐
                    │ 2. RATE LIMIT (Abuse / DoS)                           │
                    │    • Redis: ratelimit:{clientId} — NOT billing         │
                    │    • 429 + x-opsmantik-ratelimit: 1 if exceeded        │
                    └───────────────────────────┬───────────────────────────┘
                                                │
                    ┌───────────────────────────▼───────────────────────────┐
                    │ 3. REQUEST VALIDATION                                  │
                    │    • JSON parse, parseValidIngestPayload → 400 if bad  │
                    └───────────────────────────┬───────────────────────────┘
                    ┌───────────────────────────▼───────────────────────────┐
                    │ 4. IDEMPOTENCY (Gatekeeper — Billing Gate)            │
                    │    • key = SHA256(site_id + event_name + url + fp + 5s)│
                    │    • INSERT ingest_idempotency (Postgres)              │
                    │    • CONFLICT → 200 duplicate, x-opsmantik-dedup: 1   │
                    │      → STOP. Never publish. Never bill.                │
                    │    • SUCCESS → one row = one billable unit (SoT)       │
                    └───────────────────────────┬───────────────────────────┘
                                                │
                    ┌───────────────────────────▼───────────────────────────┐
                    │ 5. QUOTA (When implemented)                           │
                    │    • Read plan + usage (Redis best-effort or PG)       │
                    │    • Hard limit / cap → 429, x-opsmantik-quota-exceeded│
                    │    • Soft overage → 200, x-opsmantik-overage: true    │
                    │    • Redis NEVER used to derive invoice count         │
                    └───────────────────────────┬───────────────────────────┘
                                                │
                    ┌───────────────────────────▼───────────────────────────┐
                    │ 6. PUBLISH                                              │
                    │    • Try: qstash.publishJSON(workerUrl, payload)       │
                    │    • Success → 200 queued                              │
                    │    • Fail → INSERT ingest_fallback_buffer → 200 degraded│
                    │            x-opsmantik-fallback: true (still billable) │
                    └───────────────────────────────────────────────────────┘

    ┌──────────────────────────────────────────────────────────────────────────────┐
    │ FINANCIAL AUTHORITY (Invoice / Dispute)                                        │
    │ • ONLY Postgres: ingest_idempotency (site_id, idempotency_key, created_at)   │
    │ • Invoice count = COUNT(*) WHERE site_id = ? AND created_at IN billing_month  │
    │ • site_usage_monthly = reconciliation target (filled from above COUNT)       │
    │ • Redis: stats:* and ratelimit:* and future usage:* are NEVER invoice source │
    └──────────────────────────────────────────────────────────────────────────────┘
```

**Deterministic evaluation order (final):**

1. **Auth** — CORS + site resolution (body.s → site_id). Reject 403/400 before any billing gate.
2. **Rate limit** — Abuse/DoS. Redis-based; 429 with `x-opsmantik-ratelimit: 1`. Not quota.
3. **Idempotency** — Insert into `ingest_idempotency`. Duplicate → 200 dedup, no publish, no bill. Success → one billable unit committed.
4. **Quota** — Plan limits (hard/soft/cap). 429 with `x-opsmantik-quota-exceeded: 1` if over; Redis optional for speed, PG fallback; invoice never from Redis.
5. **Publish** — QStash or fallback buffer. Both paths already “billable” (row in idempotency exists).

---

## 2. Validation: ingest_idempotency as Single Source of Truth for Billing

| Check | Status | Note |
|-------|--------|------|
| Invoice usage defined as count from ingest_idempotency (site_id + month) | **Validated** | REVENUE_KERNEL_SPEC.md §4 lock sentence. |
| events/sessions aggregates not used for invoice | **Validated** | Spec: sanity check / drift only. |
| Duplicate request does not insert row | **Validated** | INSERT conflict → no row; response 200 duplicate. |
| Fallback buffer event already has idempotency row | **Validated** | Idempotency runs before publish; fallback is after publish failure. |
| Worker success does not create second idempotency row | **Validated** | Idempotency only at sync edge; worker does not write ingest_idempotency. |

**Conclusion:** ingest_idempotency is the single source of truth for billing. Invoice = COUNT of rows in that table for (site_id, billing_month). No other table or Redis key may be used to derive invoice amount.

---

## 3. Redis is NEVER a Financial Authority

| Component | Redis key / usage | Used for billing? |
|-----------|--------------------|-------------------|
| RateLimitService | `ratelimit:{clientId}` | **No** — abuse/DoS only. 429 is non-billable. |
| StatsService | `stats:{siteId}:{date}` (captured, gclid, junk) | **No** — dashboard realtime only. Must never feed invoice. |
| Future quota (spec) | `usage:{site_id}:{YYYY-MM}` | **No** — performance layer only. Invoice from Postgres COUNT(ingest_idempotency). |

**Invariant:** No Redis key may ever be used to compute or authorize an invoice line item. Reconciliation corrects Redis from Postgres, never the reverse.

---

## 4. Race Conditions

| Scenario | Description | Mitigation / outcome |
|----------|-------------|------------------------|
| **Concurrent same idempotency key** | Two requests same key at same time. | One INSERT wins, one gets 23505 → duplicate. Correct: one billable. |
| **Quota TOCTOU** | Read usage then later increment (worker). | Acceptable: Redis is approximate; invoice from Postgres. Slight over-delivery until reconciliation; hard_cap limits runaway. |
| **Reconciliation cron vs sync** | Cron reads COUNT while sync inserts. | COUNT is point-in-time; next run includes new rows. No double-count: idempotency rows are unique. |
| **Fallback recovery** | Multiple workers claim PENDING rows. | `get_and_claim_fallback_batch` uses FOR UPDATE SKIP LOCKED → no double process. |
| **Idempotency insert vs expiry cleanup** | Cleanup deletes row while same key re-inserted. | Rare; INSERT is authoritative. Retention policy (90–120 days) keeps billing window safe. |

---

## 5. Invariants That Must NEVER Be Broken

- **Billable Event = Idempotent Event.** If the system cannot prove an event is unique (row in ingest_idempotency), it MUST NOT bill for it.
- **ingest_idempotency is the only source for invoice count.** No Redis, no events/sessions aggregate, no fallback buffer row count — only COUNT(ingest_idempotency) per (site_id, billing_month).
- **Duplicate response never publishes and never bills.** Duplicate → 200 + x-opsmantik-dedup: 1; no QStash publish; no new row in ingest_idempotency.
- **Redis is never a financial authority.** Redis may be used for rate limit, quota cache, or dashboard stats; it must never be used to compute or authorize invoice amounts.
- **Order of evaluation is fixed.** Auth → Rate limit → Idempotency → Quota → Publish. Quota MUST run after idempotency so that duplicate requests never consume quota.
- **429 responses are never billable.** Both rate-limit 429 and quota 429: no idempotency row inserted (rate limit before idempotency; quota after idempotency but reject before publish).
- **Fallback buffer events are billable at capture time.** Row in ingest_idempotency already exists when we write to fallback buffer; recovery does not create a second billable unit.
- **Idempotency key is deterministic and server-only.** Key = f(site_id, event_name, url, session_fingerprint, time_bucket). No client-supplied id in key; no IP/UA in key.

---

## 6. Risk Table

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Redis used for invoice by mistake | Low | Critical | Spec + this audit; code review; no invoice code path reads Redis for count. |
| Idempotency table dropped or truncated | Low | Critical | Backups; retention policy; no destructive op without change control. |
| Quota check before idempotency (wrong order) | Medium | High | Freeze order: auth → rate limit → idempotency → quota → publish. PR gate. |
| Duplicate request triggers publish | Low | High | Current code: duplicate returns early, no qstash.publishJSON. Test: same payload twice → dedup. |
| Fallback buffer counted as extra billable | Low | Medium | Spec: billable at capture; idempotency row already exists. Do not count fallback rows separately. |
| Retention too short (e.g. 24h) | Medium | Medium | Spec: 90–120 days. Implement TTL/archive to match; extend ingest_idempotency.expires_at policy. |
| Two 429 types indistinguishable | Medium | Low | Header: x-opsmantik-quota-exceeded vs x-opsmantik-ratelimit. Implement when quota ships. |

---

## 7. Required Schema Constraints

| Table | Constraint | Purpose |
|-------|------------|---------|
| **ingest_idempotency** | PRIMARY KEY (site_id, idempotency_key) | Uniqueness; duplicate insert fails. |
| **ingest_idempotency** | NOT NULL(site_id, idempotency_key, created_at, expires_at) | Audit trail; retention. |
| **ingest_idempotency** | FOREIGN KEY site_id → sites(id) ON DELETE CASCADE | Tenant integrity. |
| **ingest_idempotency** | INDEX(expires_at) | Efficient TTL cleanup. |
| **ingest_fallback_buffer** | site_id FK → sites(id) | Tenant integrity. |
| **ingest_fallback_buffer** | status IN (PENDING, PROCESSING, RECOVERED, FAILED) | Recovery state machine. |
| **ingest_fallback_buffer** | INDEX(status, created_at) WHERE status = 'PENDING' | FIFO recovery. |
| **site_plans** (future) | UNIQUE(site_id) | One plan per site. |
| **site_usage_monthly** (future) | PRIMARY KEY (site_id, year_month) | One row per site per month for reconciliation. |

**RLS:** ingest_idempotency and ingest_fallback_buffer: no policies for anon/authenticated; service_role only. Tenant isolation by site_id in row.

---

## 8. Go / No-Go

| Criterion | Go? |
|-----------|-----|
| ingest_idempotency is the single source of truth for billing | **Go** — Spec and code align. |
| Redis is never financial authority | **Go** — Current Redis is rate limit + dashboard stats only; spec forbids Redis for invoice. |
| Deterministic order: auth → rate limit → idempotency → quota → publish | **Go** — Current code: auth (CORS + site) → rate limit → idempotency → publish. Quota not yet implemented; when added, MUST sit after idempotency. |
| Race conditions identified and mitigated | **Go** — Documented; idempotency INSERT conflict and FOR UPDATE SKIP LOCKED for recovery. |
| Invariants listed and frozen | **Go** — §5 above. |
| Schema constraints documented | **Go** — §7 above. |
| Retention policy for idempotency (90–120 days) | **Conditional** — Spec says 90–120 days; current implementation uses 24h TTL (expires_at). **Action:** Extend expires_at to align with spec before billing launch. |

**Overall: Go**, with one condition: **before using this pipeline for invoicing, extend ingest_idempotency retention (expires_at) to at least 90 days (or current month + 2 months) and ensure reconciliation + site_usage_monthly (and optional quota) are implemented per spec.**

---

*Bu denetim, Revenue Kernel mimarisini donduğu ve PR gate’lerde referans alınabilir.*
