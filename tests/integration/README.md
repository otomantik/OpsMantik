# Integration tests (PR-T1.1 – T1.9)

## Plan (DB-level strict ingest)

1. **Env gate**  
   All suites require Supabase env (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Most suites use `STRICT_INGEST_TEST_SITE_ID` (UUID); the cross-site conversation suite also requires at least two site rows in DB. If prerequisites are missing, tests skip with a clear reason.

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

5. **junk-stays-hidden-queue.test.ts**  
   - **Setup:** Resolve a test site via `JUNK_FLOW_TEST_SITE_ID` or `STRICT_INGEST_TEST_SITE_ID`.  
   - **Action:** Insert two `calls` in the same session, junk one via `apply_call_action_v1`, then query `get_recent_intents_lite_v1`.  
   - **Assert:** The junked row stays hidden while the sibling pending row remains visible.  
   - **Cleanup:** Delete both test calls.

6. **conversation-create-cross-site-db.test.ts**  
   - **Setup:** Resolve two distinct site rows from DB. Insert a foreign-site `call` fixture and a foreign-site `session` fixture.  
   - **Action:** Call `create_conversation_with_primary_entity` with `p_site_id = siteA` and a primary entity that belongs to `siteB`.  
   - **Assert:** RPC fails with `primary_entity_site_mismatch` and no orphan `conversations` row is created.  
   - **Cleanup:** Delete the test call/session fixtures.

7. **sales-create-cross-site-db.test.ts**  
   - **Setup:** Resolve two distinct site rows from DB. Insert a foreign-site `conversation` fixture on `siteB`.  
   - **Action:** Attempt to insert a `sales` row on `siteA` with `conversation_id = foreignConversationId`.  
   - **Assert:** DB trigger rejects the write and no orphan `sales` row is created.  
   - **Cleanup:** Delete the test conversation fixture.

8. **conversation-link-cross-site-db.test.ts**  
   - **Setup:** Resolve two distinct site rows from DB. Insert a `conversation` on `siteA`, then insert foreign-site `call`, `session`, and `event` fixtures on `siteB`.  
   - **Action:** Attempt to insert `conversation_links` rows on the `siteA` conversation for each foreign entity type.  
   - **Assert:** DB trigger rejects all three writes and no orphan `conversation_links` row is created.  
   - **Cleanup:** Delete the test conversation, event, session, and call fixtures.

9. **session-cross-site-db.test.ts**  
   - **Setup:** Resolve two distinct site rows from DB. Insert a session on `siteA`, then call `SessionService.handleSession` for `siteB` with the same UUID `client_sid`.  
   - **Action:** Force the create path to hit a duplicate UUID that belongs to another tenant.  
   - **Assert:** The foreign session is not reused or mutated; a tenant-safe replacement session is created for `siteB`.  
   - **Cleanup:** Delete both session fixtures and related events.

10. **conversation-resolve-atomic-db.test.ts**  
   - **Setup:** Create two same-site conversations and a sale already linked to one of them.  
   - **Action:** Call `resolve_conversation_with_sale_link` on the other conversation with the already-linked sale id.  
   - **Assert:** RPC fails with `sale_already_linked_elsewhere`, conversation status stays `OPEN`, and sale binding remains unchanged.  
   - **Cleanup:** Delete the test sale and conversation fixtures.

11. **sales-finalized-identity-db.test.ts**  
   - **Setup:** Insert a `CONFIRMED` sale with stable identity fields.  
   - **Action:** Attempt to mutate `amount_cents`, `currency`, or `customer_hash`.  
   - **Assert:** DB trigger rejects the update and the stored identity remains unchanged.  
   - **Cleanup:** Delete the test sale fixture.

12. **Helpers**  
   `tests/helpers/strict-ingest-helpers.ts`: `getStrictTestSiteId()`, `hasStrictIngestEnv()`, `requireStrictEnv()`, `setSiteConfig()`, `restoreSiteConfig()`, `cleanupIngestForSite()` for shared env check, config patch/restore, and cleanup.

13. **Activation SQL**  
   `docs/runbooks/STRICT_INGEST_ACTIVATION.sql`:  
   `UPDATE sites SET config = config || '{"ingest_strict_mode": true}'::jsonb WHERE id = '[SITE_ID]';`

14. **Geo**  
   `lib/geo/upsert-session-geo.ts`: Map literal city/district `'Unknown'` to NULL before writing so reports never show "Unknown" as a string.

## Run

```bash
npm run test:integration
```

Or:

```bash
node --import tsx --test --test-concurrency=1 tests/integration/strict-ingest-skip-db.test.ts tests/integration/pageview-10s-reuse-db.test.ts tests/integration/ads-attribution-strict-db.test.ts tests/integration/junk-stays-hidden-queue.test.ts tests/integration/conversation-create-cross-site-db.test.ts tests/integration/sales-create-cross-site-db.test.ts tests/integration/conversation-link-cross-site-db.test.ts tests/integration/session-cross-site-db.test.ts tests/integration/conversation-resolve-atomic-db.test.ts tests/integration/sales-finalized-identity-db.test.ts
```

Focused tenant-boundary gate:

```bash
npm run test:tenant-boundary
```

Set `STRICT_INGEST_TEST_SITE_ID` to a valid site UUID and ensure Supabase env is set; for cross-site conversation, sales, and conversation_links coverage, the DB must also contain a second site row.
