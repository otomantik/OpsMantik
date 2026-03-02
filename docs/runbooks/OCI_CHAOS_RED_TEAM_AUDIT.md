# OCI / Mizan-Mantık — Chaos & Red Team Audit

**Role:** Principal Chaos Engineer, Revenue Integrity Auditor, Distributed Systems Architect.  
**Goal:** Break the system under stress; adversarial, no validation.  
**Assumptions:** 10x traffic spike, 3 operators on same call, Redis outage, Supabase glitch, Google API partial failures, slow crons, retry storms, duplicate HTTP, multi-tenant load.

---

## SECTION 1 — RACE CONDITION STRESS TEST

### Scenario: Two operators click 60 (V3), 80 (V4), 100 (V5) within milliseconds on same call

**Can inconsistent gear states occur?**

- **Call row:** `apply_call_action_v1` uses `FOR UPDATE` and optional optimistic lock: `IF p_version IS NOT NULL AND v_call.version IS DISTINCT FROM p_version THEN RAISE P0002`. If **client sends version**, only one of 60/80/100 wins; others get 409. If **client omits version** (e.g. legacy UI or bug), **all three can succeed**: three updates, version increments three times, last writer wins for `lead_score`/`sale_amount`. So final call state is **last request’s** (e.g. 100). No “inconsistent” mix of columns from different requests; just **last-write-wins** and duplicate audit entries.
- **Vulnerability:** `app/api/calls/[id]/seal/route.ts` line 36: `const version = body.version != null ? Number(body.version) : null`. If frontend does not send `version`, **race is open**. **Mitigation:** Ensure UI always sends current `version` for seal/stage.

**Can V5 exist without V3/V4?**

- **Yes, by design.** Operator can set lead_score 100 directly. No invariant enforces “V3 before V5.” Queue insert for V5 is independent of marketing_signals. **Not a bug.**

**Can V4 overwrite V3 in wrong order?**

- **No overwrite.** V3 and V4 are **different** `google_conversion_name` (e.g. OpsMantik_V3_* vs OpsMantik_V4_*). Unique index is `(site_id, call_id, google_conversion_name)`. So we get **two rows** (one V3, one V4). Order of requests only affects which row is created first; both can exist. **Safe.**

**Can duplicate marketing_signals rows still happen?**

- **No**, for same gear. Second insert for same (site_id, call_id, google_conversion_name) hits **23505**; orchestrator treats it as idempotent success. **DB is the guard.** Application-level “existing row” check in seal route is a **read** before insert; two concurrent requests can both see “no row” and both call `evaluateAndRouteSignal`; first insert wins, second gets 23505. **Conclusion:** No duplicate rows for same gear.

**Can offline_conversion_queue receive duplicates?**

- **No**, for same call. Queue has **unique on call_id** (partial index for call-originated rows). Second `enqueueSealConversion` for same call → insert 23505 → returns `reason: 'duplicate'`. **Safe.**

**Code paths vulnerable to timing**

- **Seal route (V3/V4):** Select-then-insert is non-atomic; DB unique index corrects outcome. No transaction wrapping “read call + insert signal.”
- **Seal route (enqueue):** After RPC update, enqueue is separate. If process dies **after** update **before** enqueue, call is sealed but not in queue; **sweep** later repairs. No double-enqueue due to unique.
- **process-call-event (V2):** No lock; two simultaneous call events for same session could both emit V2. V2 dedup is **hasRecentV2Pulse** (24h window by call_id or gclid). Two call creates → two V2 attempts; first insert wins, second 23505 only if same conversion name. For V2, name is same (INTENT_CAPTURED); so second would get 23505 **if** same call_id. But two call creates typically mean two call_ids. So **two calls → two V2 rows** (intended). **No vulnerability** for same call.

**Missing transactions**

- Seal route: RPC update + V3/V4 emit + enqueue are **three separate steps**. No DB transaction. If V3/V4 insert fails, call is already confirmed; if enqueue fails, sweep can fix. **Acceptable** given sweep; not atomic.

**Missing row-level locks**

- **apply_call_action_v1** uses `FOR UPDATE` on the call row inside the RPC. So two concurrent seal requests serialize on that row. Version check (when provided) prevents double apply. **Adequate.**

**Non-atomic multi-step logic**

- **Orchestrator V2 dedup:** `hasRecentV2Pulse` (read) then insert. Two requests can both see “no recent” and both insert; second gets 23505. **Idempotent.**  
- **enqueueSealConversion:** Read primary source, consent, session dedup (select existing queue by session_id), then insert. Between “no existing” and insert, another request could insert same session’s conversion; then **idx_offline_conversion_queue_site_session_pending** (unique on site_id, session_id WHERE status IN (QUEUED, RETRY, PROCESSING)) would make second insert fail. So **session-level** duplicate is prevented by DB. **Safe.**

---

## SECTION 2 — RETRY & DUPLICATE DELIVERY

### Worker crashes after enqueue but before dispatch_status update

- **Queue (API path):** Row is inserted QUEUED. Worker **claims** via `claim_offline_conversion_jobs_v2` (status → PROCESSING). If worker crashes **after** upload to Google **before** updating row to COMPLETED, row stays PROCESSING. **recover_stuck_offline_conversion_jobs** (e.g. 15 min) sets it back to RETRY; next run will **re-claim and re-upload**. Google deduplication is by **order_id**. `buildOrderId(prefix, clickId, conversionTime, fallbackId, rowId, valueCents)` is **deterministic** for same row. So **same order_id** → Google treats as duplicate → no double count. **Conclusion:** Duplicate **send** possible; duplicate **conversion count** in Google avoided by order_id.
- **Script path:** Export returns rows; script uploads then calls **ack** with `markAsExported` (claim already done when export was called with markAsExported=true). If script crashes **after** upload **before** ack, rows stay PROCESSING. Next export (markAsExported=true) does **not** re-return those ids (export filters QUEUED/RETRY). So **same rows are not re-exported**. But script might call export again **without** having acked previous batch → **new** batch can overlap if export is not strictly “claim then return only claimed.” Actually export **returns** list then client is expected to ack. So if client never acks, rows stay PROCESSING; next export gets **different** rows (QUEUED/RETRY). So **stuck PROCESSING** rows are not re-sent by export. **Risk:** Stuck PROCESSING rows are only recovered by **recover_stuck** (runner/cron) or manual intervention. Script path has **no** automatic “mark COMPLETED” after timeout. **dispatch_status (marketing_signals):** Script exports PENDING signals; script uploads then acks. If script crashes before ack, signals stay PENDING and **will be re-exported** next time. **Duplicate send to Google.** Order_id for signals is `${clickId}_${conversionName}_${conversionTime}`.slice(0,128) or `signal_${id}`. So **same signal** → same order_id → Google dedup. **Conclusion:** Duplicate **send** possible; **revenue impact** low if order_id is stable.

### Google API returns partial_failure

- Adapter returns per-job results; runner updates each row (COMPLETED vs RETRY/FAILED). **Partial failure** is handled per row. Rows marked RETRY get next_retry_at. **No duplicate** from partial_failure itself; retried rows get same order_id. **Safe.**

### Export runs twice simultaneously

- Two GETs with **markAsExported=true** for same site. Both read QUEUED/RETRY rows, both call **claim_offline_conversion_rows_for_script_export(p_ids, p_site_id)**. RPC does `UPDATE ... WHERE q.id = ANY(p_ids) AND q.site_id = p_site_id AND q.status IN ('QUEUED', 'RETRY')`. So **first** claim flips those rows to PROCESSING; **second** claim gets **same ids** but status is now PROCESSING → **0 rows updated**. So second request gets **no** rows updated; response may still return the **same** list (built from the first read). So **both clients might upload the same list** and both ack. Ack updates by id + site_id + status PROCESSING; both acks would update the same rows to COMPLETED. **Result:** Same conversions sent **twice** to Google (two clients). Order_id same → Google dedup. **Conclusion:** Duplicate **HTTP** and duplicate **claim attempt**; only one claim succeeds; if both clients upload the same payload, Google dedup by order_id. **Safe** for count; **waste** of bandwidth and script runs.

**Conversion IDs deterministic?**

- **Yes.** `buildOrderId` uses clickId, conversionTime, rowId, valueCents → deterministic. Same row → same order_id.

**Idempotency key for Google uploads?**

- **order_id** is the idempotency key (Google Ads dedup by order_id). We set it deterministically. **Yes.**

**Could PENDING rows be resent accidentally?**

- **Yes.** marketing_signals with dispatch_status PENDING are **always** selected on export. If script **never** acks (or ack fails), next export returns **same** PENDING signals again. So **yes, PENDING can be resent.** Order_id for signals is deterministic (clickId + name + time or signal_id), so Google dedup. **Conclusion:** Resend possible; duplicate conversion count avoided.

**Can dispatch_status get stuck in limbo?**

- **Yes.** If script path never calls ack for signals, they stay **PENDING** forever. No automatic transition to SENT. **Queue** path: PROCESSING can be recovered by **recover_stuck_offline_conversion_jobs**. **Signals:** No equivalent “recover PENDING.” **Conclusion:** **dispatch_status PENDING** can be stuck indefinitely for script pipeline. **HIGH** for operability (no visibility/cleanup).

---

## SECTION 3 — 0 TL SEAL EDGE CASES

### sale_amount is 0

- **Seal path:** `computeConversionValue` returns **null** for saleAmount 0 (and after fix: null or ≤0). enqueueSealConversion returns without insert. **Safe.**  
- **enqueue-from-sales:** **Fixed:** we skip insert when `valueCents <= 0`. **Safe.**

### sale_amount is negative

- **Seal route:** Body validation rejects `sale_amount < 0` (400). So negative never reaches enqueue. **Safe.**  
- **computeConversionValue:** **Fixed:** `saleAmount == null || !Number.isFinite(saleAmount) || saleAmount <= 0` → return null. So negative (and NaN) no longer fall through to star path and return positive value. **Safe.**

### sale_amount changes after seal

- Queue row already has **value_cents** at insert time. **syncQueueValuesFromCalls** (runner) re-reads call’s lead_score/sale_amount and can **update** queue row’s value_cents. If operator later sets sale_amount to 0, `computeConversionValue(star, 0, config)` returns **null**; in sync we do `freshCents = valueUnits != null ? majorToMinor(...) : row.value_cents`. So we **keep** existing row.value_cents (do not overwrite to 0). **Conclusion:** Post-seal change to 0 does **not** overwrite queue value to 0. **Safe.**

### sale_amount updated concurrently during enqueue

- Seal route: sale_amount is read from **body** and passed to RPC. RPC applies it in one UPDATE. Enqueue runs **after** RPC with same body sale_amount. So no “concurrent update during enqueue” from same request. Another request could update the call (e.g. version+1, different sale_amount) **after** our RPC **before** our enqueue. We still call enqueue with **our** sale_amount (from our body). So we might enqueue with “stale” value. **Acceptable** (last seal wins for call; queue has unique call_id so only one row per call).

### value null converted back to 0 downstream?

- **Runner:** Filters `value_cents == null || value_cents === undefined` (skip row). **value_cents === 0** is **not** filtered; 0 is sent. So any row that **already has** 0 (e.g. from legacy or bug) would be sent. **Export:** `valueCents = Number(row.value_cents) || 0`; so null/undefined become 0 and **are sent**. **Conclusion:** Null/undefined become 0 at export and are sent. **Mitigation:** Do not insert 0 (seal + enqueue-from-sales fixed). Runner could add **safety filter:** skip or mark COMPLETED without send when value_cents <= 0.

### Sweep jobs accidentally enqueue zero?

- Sweep uses **enqueueSealConversion** with call’s sale_amount. enqueueSealConversion uses **computeConversionValue**; 0 → null → no insert. **Safe.**

### computeConversionValue used everywhere?

- **Seal path:** enqueue-seal-conversion uses it. **Runner sync:** syncQueueValuesFromCalls uses it for **updating** value_cents (only when valueUnits != null). **enqueue-from-sales:** Does **not** use it; uses `sale.amount_cents ?? 0` then we **skip when valueCents <= 0**. **Consistent** after fixes.

### Fallback default reintroducing 0?

- **Export:** `Number(row.value_cents) || 0` → missing value becomes 0 and is sent. **Defence:** Never insert 0. **Runner:** No fallback to 0 when building job; queue row’s value_cents is used. **buildOrderId** default param `valueCents = 0`; that’s for order_id hash only, not for sending value. **Conclusion:** Only export’s `|| 0` can “reintroduce” 0 for **already-stored** null/undefined. Mitigation: don’t store 0.

---

## SECTION 4 — MULTI-TENANT ISOLATION ATTACK

### Two sites with same call_id

- call_id is UUID; collision across sites is negligible. All queries that matter use **site_id** from auth or call lookup. **Safe.**

### Wrong site_id passed to getPrimarySource

- Caller (e.g. seal route, export) passes siteId from **call.site_id** (from DB by callId). So site_id is from our DB, not client input for that path. **get_call_session_for_oci(p_call_id, p_site_id)** JOINs call and session; if p_site_id ≠ call’s site_id, call row is not found (call belongs to other site). So **no cross-site data** returned. **Safe** as long as call lookup is always by id and we use call.site_id.

### marketing_signals / offline_conversion_queue query without tenant filter

- **Audited:** Export, ack, queue-rows, queue-stats, orchestrator, enqueue-seal-conversion, seal route all use **.eq('site_id', ...)**.  
- **Sweep:** `adminClient.from('offline_conversion_queue').select('call_id').not('call_id', 'is', null).limit(5000)` — **no site_id**. Global scan. Used to build **set of queued call_ids**; then sealed calls (also no site filter in sweep) are filtered to “orphans.” So sweep reads **all tenants’** queue and calls. **Intent:** One cron serves all sites. **Risk:** Info leak if result were ever exposed; perf at scale. **Severity: LOW** (service_role only; no client exposure).  
- **enqueue-from-sales:** `from('offline_conversion_queue').select('sale_id')` — **no site_id**. Global. Same: intentional for cron; insert uses sale.site_id. **LOW.**  
- **Cleanup cron:** Global counts/deletes for queue and marketing_signals (no site_id). **Intentional.**  
- **claim_offline_conversion_rows_for_script_export:** **WHERE q.site_id = p_site_id** — **tenant-scoped.**  
- **ack route:** All updates have **.eq('site_id', siteUuid)**. **Tenant-scoped.**

**Conclusion:** No **cross-site write** or **cross-site read** that would mix tenant data. Global reads exist only in cron/sweep for “all sites” processing. **Mark:** Sweep/enqueue-from-sales global select **LOW** (no cross-tenant data mix; possible future info-leak if API ever exposed).

---

## SECTION 5 — VALUE & CURRENCY CORRUPTION

### value_cents always integer?

- **Queue insert (seal):** `valueCents = Math.round(valueUnits * 100)`. **Integer.**  
- **Runner:** Uses row.value_cents (DB bigint). **queueRowToConversionJob:** `valueCents = Math.round(valueUnits * 100)` or from row. **Export:** `valueCents = Number(row.value_cents) || 0`; then `minorToMajor(valueCents, rowCurrency)`. minorToMajor divides by 10^minorUnits; result can be float. **ensureNumericValue** rounds to 2 decimals. **Conclusion:** value_cents stored and passed as number; DB type bigint. **Integer at rest.**

### Math.round inconsistencies

- **computeConversionValue:** `return Math.round(config.base_value * weight * 100) / 100` — major units, 2 decimals.  
- **value-calculator (minor):** `Math.round(effectiveAovMinor * ratio * decay)`. **Consistent.**

### Implicit number casting

- **Body:** `sale_amount = body.sale_amount != null ? Number(body.sale_amount) : null`. NaN possible; seal route rejects `sale_amount < 0` but does **not** explicitly reject NaN. So NaN could reach RPC. RPC: `(p_payload->>'sale_amount')::numeric` — in PostgreSQL, NaN casts to numeric 'NaN'. So call could get sale_amount NaN. Then **computeConversionValue(star, NaN, config)**: first if false (NaN > 0 false), second if: `!Number.isFinite(saleAmount)` true → return null. **Safe.**  
- **Large sale_amount (overflow):** value_cents is bigint; JavaScript Number is IEEE 754. Very large sale_amount could lose precision before Math.round. **MEDIUM** for extreme values (e.g. billions). No explicit cap.

---

## SECTION 6 — SMART BIDDING DISTORTION

### V2/V3/V4 spam distort optimization?

- **V2** is emitted on **every** call create (when primary source exists). High call volume ⇒ many V2s. If V2 volume is **100x** V5, funnel is top-heavy. Google may down-weight or over-weight micro-conversions. **Conclusion:** **Possible** distortion; product/tuning. **MEDIUM.**

### conversion_time accurate and monotonic?

- Seal: conversion_time = **confirmed_at** (UTC). Export/runner use queue’s conversion_time or call’s confirmed_at. **Monotonic:** Not guaranteed (e.g. backdated confirmed_at). **Accuracy:** Depends on client sending correct confirmed_at. **Temporal sanity** in enqueue-seal rejects far future/past (e.g. 90d). **Conclusion:** Generally accurate; backdated allowed within window.

### Backdated signals break attribution windows?

- Google has **conversion window** (e.g. 90 days). If conversion_time is backdated within window, it’s valid. If **after** click by more than window, Google may ignore or misattribute. **Conclusion:** Risk is **configuration** (temporal sanity window) and Google’s window. **LOW** if we enforce sanity window.

---

## SECTION 7 — SILENT FAILURE ZONES

| Location | Pattern | Effect |
|----------|---------|--------|
| **lib/domain/mizan-mantik/orchestrator.ts** | `logShadowDecision`: `.then(() => {}, () => {})` | Errors swallowed; shadow_decisions may be missing. |
| **lib/domain/mizan-mantik/orchestrator.ts** | `append_causal_dna_ledger`: `.then(() => {}, (err) => console.error(...))` | Log only; ledger can be missing. |
| **lib/ingest/process-call-event.ts** | V2_PULSE: `try { evaluateAndRouteSignal(...) } catch (v2Err) { console.error(...) }` | Call created; V2 may be missing; no alert. |
| **app/api/calls/[id]/seal/route.ts** | V3/V4: `try { ... } catch (v3v4Err) { logError(...) }` “Non-fatal” | Seal succeeds; V3/V4 may be missing; no retry. |
| **app/api/calls/[id]/seal/route.ts** | enqueueSealConversion: `try { ... } catch (enqueueErr) { logError(...) }` “Non-effort” | Seal succeeds; queue may be empty; sweep repairs. |
| **lib/oci/enqueue-seal-conversion.ts** | append_causal_dna_ledger: `.then(() => {}, () => {})` | Ledger can be missing. |
| **lib/services/pipeline-service.ts** | append_causal_dna_ledger: `.then(() => {}, () => {})` | Same. |
| **lib/oci/runner.ts** | Multiple try/catch in claim/upload/update | Errors logged; rows marked RETRY/FAILED; no alert. |
| **lib/oci/runner.ts** | `vault.decryptJson` failure | Rows marked FAILED; logRunnerError; no alert. |
| **app/api/oci/ack/route.ts** | Redis DEL/LREM in loop: `catch (redisErr) { logError; failedRedisCleanups.push }` | Ack returns success; PV cleanup may be partial; warning in body. |

**Summary:** Best-effort and try/catch are **everywhere** for V2, V3/V4, enqueue, ledger, shadow. **Failure does not surface to operator**; only logs. **Sweep** partially mitigates “sealed but not enqueued.” No automated alert on “V2/V3/V4 emit failed” or “enqueue failed.”

---

## SECTION 8 — RED TEAM CONCLUSION

### 1) Top 5 CRITICAL vulnerabilities

| # | Vulnerability | File(s) | Why CRITICAL |
|---|----------------|--------|--------------|
| 1 | **0 TL to Google via enqueue-from-sales** (fixed in codebase: skip when valueCents <= 0) | `app/api/cron/oci/enqueue-from-sales/route.ts` | Policy violation; 0 TL conversions sent. |
| 2 | **Negative sale_amount in computeConversionValue** could return positive (star path) — **fixed:** treat ≤0 and non-finite as null | `lib/oci/oci-config.ts` | Wrong value sent; revenue/attribution. |
| 3 | **Client omits version on seal** → concurrent 60/80/100 all succeed, last-write-wins | `app/api/calls/[id]/seal/route.ts` | Duplicate audit; possible confusion; no 409. |
| 4 | **marketing_signals PENDING never auto-cleared** (script path) | Script + `app/api/oci/google-ads-export`, ack | Re-export same signals; no DLQ; stuck forever if script never acks. |
| 5 | **Export sends value_cents 0** when row has 0 or null (Number(x)\|\|0) | `app/api/oci/google-ads-export/route.ts` | Defence is “never insert 0”; no server-side filter for 0. |

### 2) Top 5 HIGH risks

| # | Risk | File(s) | Why HIGH |
|----|------|--------|----------|
| 1 | **V3/V4 / enqueue best-effort** — silent failure, no retry, no alert | `app/api/calls/[id]/seal/route.ts` | Missing conversions; operator unaware. |
| 2 | **Runner does not skip value_cents === 0** — only null/undefined | `lib/oci/runner.ts` (rowsWithValue filter) | If 0 ever gets in, it is sent. |
| 3 | **Redis outage** — V1_PAGEVIEW push and hasRecentV2Pulse (DB) unaffected; V2 dedup uses DB. Redis only for pv queue and pv data. So **V1 pipeline fails**; V2–V5 can continue | `lib/domain/mizan-mantik/orchestrator.ts` | V1 loss; no fallback. |
| 4 | **Supabase transient** — insert/update can fail; retries not systematic; 23505 handled; others may throw and be caught (e.g. seal route catch → log, return success for seal) | Multiple | Partial state; sweep helps for queue. |
| 5 | **Global SELECT in sweep/enqueue-from-sales** (no site_id) | `app/api/cron/sweep-unsent-conversions`, `app/api/cron/oci/enqueue-from-sales` | Info leak if ever exposed; perf at scale. |

### 3) Probability × Impact assessment

- **0 TL to Google (enqueue-from-sales):** **P medium × I critical** → **CRITICAL** (fixed in code).  
- **Version omitted (race):** **P medium × I high** → **HIGH** (depends on client).  
- **PENDING stuck / re-sent:** **P high × I medium** → **HIGH** (script discipline).  
- **Best-effort V3/V4/enqueue fail:** **P medium × I high** → **HIGH** (no alert).  
- **Runner sends 0:** **P low × I high** → **MEDIUM** (if 0 row exists).  
- **Negative/NaN sale_amount:** **P low × I critical** → **MEDIUM** (fixed in code).  
- **Redis down:** **P low × I medium** (V1 only) → **LOW–MEDIUM.**

### 4) Exact file paths involved

- `app/api/calls/[id]/seal/route.ts` — version, V3/V4, enqueue best-effort.  
- `app/api/cron/oci/enqueue-from-sales/route.ts` — 0 TL skip (fixed).  
- `lib/oci/oci-config.ts` — computeConversionValue (negative/NaN fixed).  
- `app/api/oci/google-ads-export/route.ts` — export queue/signals; no 0 filter.  
- `app/api/oci/ack/route.ts` — signal dispatch_status SENT; Redis cleanup.  
- `lib/oci/runner.ts` — rowsWithValue (null/undefined only); syncQueueValuesFromCalls.  
- `lib/domain/mizan-mantik/orchestrator.ts` — V2 dedup; Redis V1; ledger/shadow best-effort.  
- `lib/ingest/process-call-event.ts` — V2 emit try/catch.  
- `supabase/migrations/20260330000000_oci_claim_and_attempt_cap.sql` — claim with site_id.  
- `supabase/migrations/20260316000000_rpc_optimistic_locking.sql` — version check.

### 5) Concrete mitigation steps

1. **Enforce version on seal:** Require `version` in body for POST seal (return 400 if missing); or always fetch current version server-side and pass to RPC so concurrent requests get 409.  
2. **Filter 0 at export and runner:** In google-ads-export, skip queue rows with `(Number(row.value_cents) || 0) <= 0` (or mark COMPLETED without send). In runner, exclude rows with `value_cents <= 0` from jobs (or mark COMPLETED and skip upload).  
3. **PENDING signals:** Add cron or script contract: “ack within T” or “mark exported_at”; or run a job that marks old PENDING as EXPIRED and exclude from export.  
4. **Alerting:** Add alerts on “enqueue failed” (seal route), “V2/V3/V4 emit failed,” and on queue depth / FAILED count per site.  
5. **Redis resilience:** Document V1 dependency; consider fallback (e.g. write to DB queue if Redis unavailable) for V1.  
6. **Sweep/enqueue-from-sales:** Keep global read for cron; ensure no API ever exposes raw queue/sales list without site filter.

---

**Summary:** System is **robust** for same-call races (DB unique indexes, version when sent, queue unique call_id). **0 TL** and **negative/NaN** paths are fixed. **Remaining critical/high:** version not sent (client), PENDING lifecycle (script), best-effort silence (alerting), and defence-in-depth for 0 (export/runner filter). Assume production scale and worst timing; the above mitigations close the main adversarial gaps.
