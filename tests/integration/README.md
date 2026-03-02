# Integration tests (PR-T1.1 – T1.3)

## Plan (DB-level strict ingest)

1. **Env gate**  
   All three suites require `STRICT_INGEST_TEST_SITE_ID` (UUID) and Supabase env (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). If missing, tests skip with a clear reason.

2. **strict-ingest-skip-db.test.ts**  
   - **Setup:** Use existing site from env; set `traffic_debloat: true` (or `ingest_strict_mode: true`) on `sites.config`; restore in `t.after`.  
   - **Action:** Run the same code path as the worker skip branch (bot UA `curl/8.0`, no click id): idempotency insert with `billable: false`, then `processed_signals` insert with status `skipped`. No HTTP call to the worker (would require QStash signature).  
   - **Assert:** `ingest_idempotency` row exists with `billable = false`; `processed_signals` has status `skipped`; session count unchanged; `getUsagePgCount` unchanged.  
   - **Retry:** Call `tryInsertIdempotencyKey` again with same key; assert `duplicate: true`, no new session.  
   - **Cleanup:** Restore site config; delete the idempotency and `processed_signals` rows created by the test.

3. **pageview-10s-reuse-db.test.ts**  
   - **Setup:** Set `page_view_10s_session_reuse: true` for the test site; restore in `t.after`.  
   - **Action:** Send two `page_view` events (same fingerprint, same normalized URL) by calling `processSyncEvent` twice with distinct Qstash message IDs (within 10s; no sleep, calls are sequential).  
   - **Assert:** Exactly one session; two events with the same `session_id`; `session.updated_at` increased after the second event (if column exists).  
   - **Negative:** Same site, different URL or different fingerprint; assert two sessions.  
   - **Cleanup:** Delete created sessions, events, `processed_signals` for the test site.

4. **ads-attribution-strict-db.test.ts**  
   - **Setup:** Set `traffic_debloat: true`; restore in `t.after`.  
   - **Cases:**  
     - **A:** Referrer `https://google.com`, no gclid → `attribution_source` must not be a Google Ads source.  
     - **B:** gclid `123` (length &lt; 10) → must not be Google Ads.  
     - **C:** gclid `abcdef123456` (valid) → `attribution_source` must be `First Click (Paid)` (stored value for Google Ads (Paid)).  
   - **Assert:** Query `sessions.attribution_source` after running `processSyncEvent` for each case.  
   - **Cleanup:** Delete created sessions, events, `processed_signals`.

5. **Helpers**  
   `tests/helpers/strict-ingest-helpers.ts`: `getStrictTestSiteId()`, `hasStrictIngestEnv()`, `requireStrictEnv()`, `setSiteConfig()`, `restoreSiteConfig()`, `cleanupIngestForSite()` for shared env check, config patch/restore, and cleanup.

6. **Activation SQL**  
   `docs/runbooks/STRICT_INGEST_ACTIVATION.sql`:  
   `UPDATE sites SET config = config || '{"ingest_strict_mode": true}'::jsonb WHERE id = '[SITE_ID]';`

7. **Geo**  
   `lib/geo/upsert-session-geo.ts`: Map literal city/district `'Unknown'` to NULL before writing so reports never show "Unknown" as a string.

## Run

```bash
npm run test:integration
```

Or:

```bash
node --import tsx --test tests/integration/strict-ingest-skip-db.test.ts tests/integration/pageview-10s-reuse-db.test.ts tests/integration/ads-attribution-strict-db.test.ts
```

Set `STRICT_INGEST_TEST_SITE_ID` to a valid site UUID and ensure Supabase env is set; otherwise tests are skipped.
