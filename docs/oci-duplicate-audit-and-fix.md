# OCI Duplicate Conversion — Diagnosis & Guardrails

## 1. Where the duplicate leak happens

### 1.1 Frontend: "Approve all" = N seals for same session
- **File:** `lib/hooks/use-intent-qualification.ts`
- **Flow:** When operator approves with `matchedSessionId`, we fetch **all** call ids in that session (`source='click'`, `status in ['intent',null]`), then loop and call **POST /api/calls/${callId}/seal** for **each** call.
- **Result:** Same session → multiple calls → multiple seal API calls → **multiple enqueueSealConversion()** → multiple rows in `offline_conversion_queue` (one per call_id). UNIQUE(call_id) allows this because each row has a different call_id.
- **Root cause:** 1 Session = N Calls = N Queue rows. No "one conversion per session" at enqueue time.

### 1.2 Enqueue: No session-level deduplication
- **File:** `lib/oci/enqueue-seal-conversion.ts`
- **Current:** Inserts one row per call_id. Only idempotency is UNIQUE(call_id) (duplicate same call → 23505).
- **Missing:** Check that no **other** row exists for the same `matched_session_id` in status QUEUED/RETRY/PROCESSING before insert.

### 1.3 Export: Already one-per-session (application-level)
- **File:** `app/api/oci/google-ads-export/route.ts`
- **Current:** We dedupe by session at export time (earliest conversion_time per session), so script receives 1 row per session. Duplicate queue rows are marked COMPLETED (skipped). This is a **mitigation** but not the root fix; we still write N rows per session and waste queue + recover cycles.

### 1.4 Google Ads: No orderId
- **Script:** `scripts/google-ads-oci/GoogleAdsScript.js` sends: gclid, conversion name, time, value, currency. **No Order ID / Conversion ID.**
- **Effect:** If the same conversion is sent twice (e.g. retry after PROCESSING), Google may count it twice. Google Ads uses **orderId** (or equivalent) to deduplicate: same orderId → second upload ignored.

### 1.5 PROCESSING state lock
- **Export API** sets rows to PROCESSING when script fetches; **Script** uploads then calls **POST /api/oci/ack** to set COMPLETED. If script crashes before ack, rows stay PROCESSING.
- **Recover cron** (`recover_stuck_offline_conversion_jobs`) moves PROCESSING with `claimed_at` &lt; 15 min to RETRY. So stale rows are re-sent. Without orderId, Google can count duplicates.
- **Backend runner** (`lib/oci/runner.ts`) does set COMPLETED/FAILED in try/catch and bulk updates; that path is correct. The Script path is the one that needed ack (already added).

---

## 2. Fixes implemented

1. **enqueueSealConversion:** Before insert, resolve call's `matched_session_id` and check if any queue row exists for that session (join queue ↔ calls) in status QUEUED/RETRY/PROCESSING. If yes → return `{ enqueued: false, reason: 'duplicate_session' }`. Then insert (and after migration include `session_id`).
2. **DB migration:** Add `session_id` to `offline_conversion_queue`, backfill from `calls.matched_session_id`, add UNIQUE partial index on `(site_id, session_id)` WHERE `status IN ('QUEUED','RETRY','PROCESSING')` AND `session_id IS NOT NULL`.
3. **Export + Script:** Add `orderId` (queue row id) to export payload. Script: add "Order ID" column and send `row.id` so Google can deduplicate.
4. **Recover:** Log when recovering stale jobs (recovered count). The recover-processing route now logs: `Recovering stale OCI job(s): N` when N > 0. Backend runner (`lib/oci/runner.ts`) already updates every claimed row to COMPLETED/FAILED/RETRY in try/catch and bulk updates; no change needed there.
