# OCI / Five-Gear (V1–V5) — Architectural Audit

**Role:** Principal Systems Auditor, Principal Backend Engineer, Revenue-Risk Analyst  
**Scope:** Full architectural audit; break the system logically.  
**Assumptions:** Real production traffic, concurrent operators, multi-tenant load, retry storms, partial Google API failures, Redis hiccups, duplicate user actions, missing click IDs, race conditions.

---

## SECTION 1 — LOGICAL CONSISTENCY AUDIT

### 1.1 Is the Five-Gear flow logically consistent?

**V2 → V3 → V4 → V5 order**

- **V2_PULSE** is emitted from `process-call-event.ts` (call created); **V3_ENGAGE** / **V4_INTENT** from seal route when lead_score is 60 or 80; **V5_SEAL** from seal route when lead_score is 100 and value > 0.
- There is **no DB or application invariant** enforcing “V3 only after V2” or “V5 only after V3/V4.” A call can have:
  - V2 only (created, never sealed).
  - V3 or V4 only (operator sets 60/80 without prior V2 in same session — e.g. direct seal from War Room).
  - V5 only (operator sets 100 with sale_amount > 0, no 60/80).
- **Conclusion:** Order is **not** strictly enforced. V5 can exist without V3/V4; V3/V4 can exist without V2. This is **logically consistent** with “operator can set any stage,” but **Smart Bidding** may see V3/V4 without prior V2 (weaker funnel consistency).

**Contradictory states**

- Same call cannot produce two different **gears for the same conversion name**: `idx_marketing_signals_site_call_gear` unique on `(site_id, call_id, google_conversion_name)` WHERE `call_id IS NOT NULL` prevents duplicate V2/V3/V4 per call (`orchestrator.ts` insert; 23505 handled as idempotent success).
- **Conclusion:** No contradictory **same-gear** states per call. Cross-gear ordering is intentionally relaxed.

**Risk:** **LOW** for consistency; **MEDIUM** for optimization (funnel signal quality if V3/V4 without V2 dominate).

---

### 1.2 Does 0 TL seal truly never reach Google?

**Seal path (War Room)**

- `lib/oci/oci-config.ts`: `computeConversionValue(star, saleAmount, config)` returns **null** when `saleAmount === 0 || saleAmount == null` (comment: “0 TL mühür Google'a gönderilmez”).
- `enqueue-seal-conversion.ts` uses `computeConversionValue`; when it returns `null`, `enqueueSealConversion` returns `enqueued: false`, reason `no_sale_amount` — **no queue insert**.
- **Conclusion:** Seal path **correctly** blocks 0 TL from queue.

**Alternative path — CRITICAL**

- **`app/api/cron/oci/enqueue-from-sales/route.ts`** (lines 92–100):
  - Inserts into `offline_conversion_queue` with **`value_cents: sale.amount_cents ?? 0`**.
  - No check for `sale.amount_cents > 0`. CONFIRMED sales with **0 or null** amount are enqueued with **value_cents = 0**.
- **Script export** (`app/api/oci/google-ads-export/route.ts`): Builds items from queue with `valueCents = Number(row.value_cents) || 0` and `conversionValue = ensureNumericValue(minorToMajor(...))` — **no filter** for value_cents > 0; **0 is sent to Google**.
- **Runner** (`lib/oci/runner.ts`): Filters only `value_cents == null || value_cents === undefined` (lines 561–567, 843–850). **value_cents === 0 is not filtered**; 0 is sent to the adapter.
- **Conclusion:** **0 TL can reach Google** via the **enqueue-from-sales** path. Sweep uses `enqueueSealConversion`, so sweep does **not** reintroduce 0 TL.

**Recommendation:** **CRITICAL.** In `enqueue-from-sales/route.ts`, skip insert when `(sale.amount_cents ?? 0) === 0` (or treat like seal: do not enqueue “0 TL” conversions). Optionally add a **safety net** in export and runner: skip or mark COMPLETED without send for rows with `value_cents <= 0`.

---

### 1.3 Is click-id usage fully safe?

**Missing gclid but marketing_signals row exists**

- **marketing_signals** can have `call_id` set and conversion_value from decay; they do **not** store gclid. Click ID is resolved at **export** time via `getPrimarySourceBatch(siteUuid, signalCallIds)` (`google-ads-export/route.ts`).
- If no primary source (session/call) has gclid/wbraid/gbraid, the export loop **skips** the signal: `if (!clickId) continue;` (lines 196–197). So **unattributed signals are not sent**.
- **Conclusion:** Safe: no click ID ⇒ not exported.

**Wrong click-id for a call**

- `getPrimarySource(siteId, { callId })` uses RPC `get_call_session_for_oci(p_call_id, p_site_id)`, which JOINs `calls c` and `sessions s` on `s.id = c.matched_session_id`, with `c.id = p_call_id` and `c.site_id = p_site_id`. So **one session per call**, and gclid comes from that session.
- **Conclusion:** Attribution is per-call → matched_session → that session’s gclid. No cross-call mixing **within** the RPC. Risk of wrong click-id is **LOW** (e.g. only if `matched_session_id` is wrong in DB).

**Queue rows**

- Seal path and enqueue-from-sales store **gclid, wbraid, gbraid** on the queue row (from primary source or conversation). Export uses row’s own click IDs for queue pipeline. **Conclusion:** No accidental cross-call attribution for queue rows if row was created with correct call/sale context.

---

## SECTION 2 — CONCURRENCY & DUPLICATE RISK

### 2.1 Race conditions

**Two operators press 60 simultaneously**

- Both call `apply_call_action_v1` with same `p_version` (if client sends it). RPC uses `FOR UPDATE` and **optimistic lock**: `IF p_version IS NOT NULL AND v_call.version IS DISTINCT FROM p_version THEN RAISE P0002` (`20260316000000_rpc_optimistic_locking.sql`). First update succeeds and increments version; second gets **P0002** and API returns 409.
- If client **does not** send `p_version`, the version check is **skipped** (`IF p_version IS NOT NULL AND ...`). Both requests can **succeed**; call is updated twice (audit log has two entries). **V3/V4 emit:** Each does a **select-then-insert** in seal route; orchestrator insert is protected by **unique index** on `(site_id, call_id, google_conversion_name)`. Second insert gets **23505** and orchestrator returns `routed: true` (idempotent). So at most **one** marketing_signals row per (call, gear).
- **Conclusion:** Duplicate **state** (double update) possible if version not sent; duplicate **V3/V4 signal** is prevented by DB unique index.

**60 then 80 within milliseconds**

- Same as above: two updates; version prevents second if sent. Two different gears (V3 vs V4) → two different `google_conversion_name` values → **two rows** allowed by unique index. So call can have both V3 and V4. **Conclusion:** No logical bug; intended.

**Seal (100) pressed twice**

- First seal: queue insert. Second seal: `enqueueSealConversion` again; queue insert fails **23505** (unique on `call_id` for call-originated rows — `offline_conversion_queue_call_id_key` partial unique in `20260225000000_seal_to_oci_queue_call_id.sql`). Returns `reason: 'duplicate'`. **Conclusion:** Idempotent; at most one queue row per call.

---

### 2.2 DB-level guarantees

**Partial unique index (V2/V3/V4)**

- `idx_marketing_signals_site_call_gear` on `(site_id, call_id, google_conversion_name)` **WHERE call_id IS NOT NULL**.
- **Conclusion:** Fully prevents duplicate (site, call, gear) when `call_id` is set. Rows with **call_id NULL** are **not** constrained; legacy or other code could insert multiple same-gear rows for (site, null, name). Orchestrator always passes `callId` for V2/V3/V4, so **orchestrator path** is safe.

**Inserts bypassing orchestrator**

- Seal route and process-call-event use **orchestrator** for V2/V3/V4. No other code found that inserts into `marketing_signals` for OCI gears. **Conclusion:** No bypass identified.

**Two concurrent requests both pass dedup before insert**

- Orchestrator V2 dedup is **application-level** (`hasRecentV2Pulse`). For V3/V4, seal route does **application-level** “existing row” check then `evaluateAndRouteSignal` → insert. Two concurrent requests can **both** pass the “existing.length === 0” check; **first** insert wins, **second** gets 23505 and orchestrator returns `routed: true`. **Conclusion:** DB unique index is the real guarantee; application check reduces unnecessary work but is not the sole guard.

---

### 2.3 Idempotency

**V2/V3/V4**

- Retry or duplicate request → same (site_id, call_id, google_conversion_name) → 23505 → treated as success. **Conclusion:** Idempotent.

**V5 queue**

- Insert uses unique on **call_id** (call-originated) or **sale_id** (sale-originated). Retry → 23505 → `enqueueSealConversion` returns duplicate. **Conclusion:** Idempotent.

**Google receiving duplicate conversions**

- **Script export:** Client (e.g. Google Ads Script) calls export, then uploads. If client retries **without** marking exported, same rows can be exported again. **markAsExported** triggers `claim_offline_conversion_rows_for_script_export` and status moves to PROCESSING/COMPLETED; if client does not call with `markAsExported=true` after successful upload, **duplicate send** is possible. **Conclusion:** Idempotency depends on **client** using order_id and/or calling markAsExported; server does not enforce “only export once.”
- **Runner (API path):** Claim uses `claim_offline_conversion_jobs_v2` (FOR UPDATE SKIP LOCKED). Once claimed, row is PROCESSING; outcome (COMPLETED/FAILED/RETRY) is updated. No double-claim of same row. Google deduplication is by **order_id** (buildOrderId). **Conclusion:** Server-side idempotent; duplicate to Google only if order_id is reused (buildOrderId is deterministic from click_id, time, row id, value).

---

## SECTION 3 — EXPORT & DELIVERY FAILURE

### 3.1 Partial Google API failure

- **Runner:** Uses adapter `uploadConversions`; per-row results drive status updates (COMPLETED / RETRY / FAILED). **dispatch_status** in codebase refers to **marketing_signals** (`PENDING` → script/export flow); queue uses **status** (QUEUED, RETRY, PROCESSING, COMPLETED, FAILED).
- **Rows stuck in PENDING (marketing_signals):** Script export reads `dispatch_status = 'PENDING'` and returns them; there is **no** automatic transition to a “sent” state in DB for script pipeline. So script **must** call an ACK/update endpoint to move them; if script fails after upload, rows **remain PENDING** and can be re-exported (duplicate risk or re-send).
- **Queue (runner):** On partial_failure, adapter returns per-job results; runner updates each row (COMPLETED vs RETRY/FAILED). **Conclusion:** Queue status is consistent with what we tried; RETRY rows get `next_retry_at`. No built-in dead-letter **table**; “dead-letter” is effectively **FAILED** status and optional archive (e.g. cleansing protocol tombstones). **Visibility:** FAILED and RETRY are visible via status/last_error/next_retry_at.

---

### 3.2 Export tenant isolation

- **google-ads-export:** All queries use **siteId** (resolved from auth or param and validated). Queue: `.eq('site_id', siteUuid)`; marketing_signals: `.eq('site_id', siteUuid)`. API key auth is bound to `site.oci_api_key` (P0-4.1). **Conclusion:** Export is site-scoped; no cross-tenant leakage in read path.
- **claim_offline_conversion_rows_for_script_export:** Takes `p_site_id` and `p_ids`; RPC must filter by site (implementation not re-read; design is tenant-scoped). **Conclusion:** Assume correct; recommend verifying RPC body uses `p_site_id` in WHERE.

---

### 3.3 Value correctness

- **Currency:** Export uses `minorToMajor(valueCents, rowCurrency)` and `ensureCurrencyCode`. `getMinorUnits` in `lib/i18n/currency.ts` handles TRY/EUR/USD (2), JPY/KRW (0), KWD/BHD (3), etc. **Conclusion:** Major/minor is currency-aware; risk of **wrong decimal** for a given currency is LOW.
- **Rounding:** `ensureNumericValue` rounds to 2 decimals; minor units are integers. **Conclusion:** Rounding risk is LOW.

---

## SECTION 4 — FUNNEL & OPTIMIZATION RISK

### 4.1 Smart Bidding confusion

- **Micro-conversions:** V1 (0), V2 (soft decay), V3 (standard), V4 (aggressive), V5 (value). Many micro-conversions per journey can dilute “main” conversion. **Risk:** MEDIUM (product/tuning).
- **V2 dominating:** V2 is emitted on **every** call create (if primary source and flow allow). High call volume ⇒ many V2s. **Risk:** MEDIUM (noise if not tuned).
- **Missing value scaling:** V2–V4 use AOV and decay; V5 uses actual value. **Conclusion:** Documented; no bug identified.

### 4.2 conversion_time

- **Timezone:** Export uses `formatGoogleAdsTime(rawTime, site.timezone)` (site timezone). Runner uses queue/conversion_time. **Conclusion:** Consistent use of site timezone in export.
- **Late imports / backdated:** Queue stores `conversion_time` (e.g. confirmed_at). No server-side check that conversion_time is “not in future” in export (temporal-sanity used in enqueue-seal). **Risk:** LOW; recommend validating in export if needed.

---

## SECTION 5 — SILENT FAILURE MODES

1. **append_causal_dna_ledger / insert_shadow_decision**  
   Fire-and-forget (`.then(() => {}, () => {})`). Errors only in console. **Impact:** Ledger/shadow data may be missing; no data loss for core OCI flow.

2. **V2_PULSE emit in process-call-event**  
   Try/catch; on failure only `console.error`. **Impact:** Call is created; V2 may be missing. Non-fatal by design.

3. **V3/V4 emit in seal route**  
   Try/catch; `logError`; “Non-fatal: seal succeeded; V3/V4 emit is best-effort.” **Impact:** Seal and V5 enqueue can succeed while V3/V4 are missing.

4. **enqueueSealConversion in seal route**  
   Try/catch; “Non-fatal: seal succeeded; OCI enqueue is best-effort.” **Impact:** Call can be sealed but **never** enter queue; no retry from UI. Sweep cron can later pick up “orphaned” sealed calls.

5. **Runner: syncQueueValuesFromCalls**  
   For sale-originated rows (no call_id), sync is skipped. For call-originated rows with sale_amount 0, `computeConversionValue` returns null → `freshCents` stays `row.value_cents` (can be 0). **Impact:** 0 value rows from enqueue-from-sales are **still sent** (runner does not skip value_cents === 0).

6. **System “working” but Google receives nothing**  
   Possible if: credentials missing/decrypt fail (rows marked FAILED); site uses script but script never calls export or markAsExported; or export always fails after claim. **Recommendation:** Monitoring on queue depth per site and FAILED count; alert on “stuck” PENDING/QUEUED.

---

## SECTION 6 — TENANT & DATA ISOLATION

1. **Session updates**  
   Previous audit fixed `process-sync-event.ts` sessions update to include `.eq('site_id', siteIdUuid)`. No other session update path re-audited here; assume fixed.

2. **Global queries**  
   - **enqueue-from-sales:** Selects **sales** without site filter (all sites); **offline_conversion_queue** select is without site filter (all sale_ids). Inserts use `sale.site_id` per row. **Conclusion:** Correct per-row tenant; no cross-tenant write.
   - **list_offline_conversion_groups:** Returns groups by (site_id, provider_key); claim RPCs take `p_site_id`. **Conclusion:** Tenant-scoped.

3. **RPC misuse**  
   - `get_call_session_for_oci(p_call_id, p_site_id)` — caller supplies both. If caller passes another site’s call_id and own site_id, JOIN may return no row (call belongs to other site). **Conclusion:** No privilege escalation if call_id is not guessable; RPC is SECURITY DEFINER, so caller must be trusted (service_role).

---

## SECTION 7 — RISK RATING

| # | Issue | Severity | Probability | Revenue impact | Attribution impact | Recommended fix |
|---|------|----------|-------------|----------------|--------------------|-----------------|
| 1 | **enqueue-from-sales** enqueues 0 TL (value_cents: sale.amount_cents ?? 0) | **CRITICAL** | MEDIUM | 0 TL conversions sent to Google; policy violation | Incorrect value signal | Skip insert when `(sale.amount_cents ?? 0) === 0`; optionally filter value_cents <= 0 in export/runner |
| 2 | Seal route V3/V4 / enqueue “best-effort” — can silently fail | HIGH | MEDIUM | Missing micro-conversions | Missing signals | Add retry (e.g. sweep for “sealed but no V3/V4”); or at least alert on shadow_decisions / missing signals |
| 3 | Script export: duplicate send if client doesn’t markAsExported | MEDIUM | MEDIUM | Duplicate conversions to Google | Over-counting | Document client contract; consider idempotency key or one-time export token |
| 4 | marketing_signals PENDING never auto-cleared (script path) | MEDIUM | LOW | Re-export same rows | Duplicate or re-send | Script must ACK; or add “exported_at” and filter in export |
| 5 | Optimistic lock skipped when version not sent (double seal update) | LOW | LOW | None | None | Ensure client always sends version for seal |
| 6 | V3/V4 without V2 (funnel order not enforced) | LOW | HIGH | None | Weaker funnel consistency for bidding | Product decision; optional: document or restrict |
| 7 | append_causal_dna_ledger / insert_shadow_decision best-effort | LOW | LOW | None | None | Optional: queue to durable log or retry |

---

**Summary**

- **0 TL to Google:** Only guaranteed **not** on the **seal** path. The **enqueue-from-sales** path **can** enqueue and send 0 TL — **CRITICAL** fix required.
- **Concurrency and duplicates:** DB unique indexes and queue constraints make V2/V3/V4 and V5 queue idempotent; seal double-press and concurrent 60/80 are handled; version should be sent from client to avoid double state update.
- **Export and runner:** Tenant-scoped; value/currency handling is consistent. Runner does **not** skip 0 value; script export does **not** filter 0.
- **Silent failures:** Several best-effort paths (V2, V3/V4, enqueue, ledger) can fail without failing the main operation; sweep partially mitigates orphan seals.
