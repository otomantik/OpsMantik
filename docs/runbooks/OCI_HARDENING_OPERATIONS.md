---
status: active
---

# OCI Hardening Operations Runbook

This runbook covers the operational procedures for the OCI (Offline Conversion Import) hardening phase, specifically the rollout of strict fail-closed semantics for panel mutations and the necessary observability to maintain system health.

Canonical upload authority for Google batch remains **queue-only**: `GET /api/oci/google-ads-export` reads `offline_conversion_queue` only. `marketing_signals` is legacy/audit/recovery support and not an independent upload source.

### Queue status mutation policy (OCI Truth)

- **Never** run ad-hoc `UPDATE offline_conversion_queue ... SET status = ...` in production troubleshooting. That bypasses `oci_queue_transitions`, snapshot apply, and the partial DB FSM — it is a **regression** against Revenue Truth.
- **Do** use approved paths: cron **`/api/cron/providers/recover-processing`**, maintenance kernels, control-plane **`update_queue_status_locked`**, ledger RPCs (`append_script_*`, `append_worker_transition_batch_v2`), and **PR-9K** incident tools (dry-run by default — see PR-9K section below).
- **Read first:** [`OCI_QUEUE_REPAIR_INDEX.md`](./OCI_QUEUE_REPAIR_INDEX.md).

## Site identity: `public_id` vs `sites.id` (PR-9H.5B.0A)

- **Google Ads Script Properties** (`OPSMANTIK_SITE_ID`) usually store **`sites.public_id`** (32-character hex string).
- **`offline_conversion_queue.site_id`** (and most site-scoped FKs) reference **`sites.id`** — the internal UUID.

If you filter `offline_conversion_queue` with **`public_id`** directly on **`site_id`**, you get **zero rows** even when data exists.

**Audit scripts:** `scripts/db/pr9h5b-queue-coverage-audit.mjs` accepts either identifier via **`TARGET_SITE_ID`** / **`OPSMANTIK_SITE_ID`**, resolves through **`sites`**, and only then queries the queue. Shared helper: **`scripts/db/lib/resolve-site-identity.mjs`**.

**Manual SQL (Supabase):** resolve once in a CTE, then scope all queue queries to **`resolved_site_uuid`**:

```sql
WITH resolved_site AS (
  SELECT id AS site_uuid, public_id
  FROM sites
  WHERE id::text = :operator_input
     OR public_id = :operator_input
  LIMIT 2
)
SELECT rs.site_uuid, rs.public_id, q.status, COUNT(*) AS cnt
FROM resolved_site rs
JOIN offline_conversion_queue q ON q.site_id = rs.site_uuid AND q.provider_key = 'google_ads'
GROUP BY rs.site_uuid, rs.public_id, q.status;
```

If `resolved_site` returns **0 rows**, the identifier is wrong; if **>1 row**, resolve ambiguity before continuing.

**Example — Koç Oto Kurtarma**

| Field | Value |
|--------|--------|
| `sites.public_id` | `93cb9966bcf349c1b4ece8ea34142ace` |
| `sites.id` (queue FK) | `3276893e-0433-4e35-95f2-4e80cf863f4c` |

### Why QUEUED rows do not appear in Google Ads upload log

- **`QUEUED` / `RETRY` in `offline_conversion_queue`** = local **candidates** for the export API. They are **not** Google-side facts until a provider upload succeeds.
- **Google Ads “upload log”** (bulk offline conversions history in the Google Ads UI) lists rows **submitted to Google** via **`upload.apply()`** (Scripts) or the equivalent API upload — **not** OpsMantik DB state by itself.
- **Required path** (journal-only architecture): `offline_conversion_queue` (QUEUED/RETRY) → **`GET /api/oci/google-ads-export`** (`buildExportItems`: sendability, value/time gates, single-conversion / highest-gear policy) → returned payload → **Google Ads Script / runner** validation → **`upload.apply()`** → **then** a line can appear in Google’s upload history → **`POST /api/oci/ack`** reconciles queue state (ACK does **not** create a Google upload log row).

### PR-9I.1 — ACK SUCCESS trusts the export claim snapshot

- **Export-time sendability and gates are authoritative** when `markAsExported=true` claims rows to **`PROCESSING`** (`append_script_claim_transition_batch`). Operators must still pass PEEK / preview diagnostics before broad drain.
- **`POST /api/oci/ack` SUCCESS** finalizes **claimed** journal rows (`PROCESSING` → **`COMPLETED`** or **`UPLOADED`** per `pendingConfirmation`). It **does not** re-query live `calls` status or re-run **`isQueueRowSendableForGoogleAdsExport`** as a hard blocker. Post-claim call drift is **not** a reason to **`FAILED`** a row that already uploaded under the prior claim contract.
- **Replay**: Rows already **`COMPLETED`**, **`UPLOADED`**, or **`COMPLETED_UNVERIFIED`** count as idempotent success (no duplicate transition required).
- **Script vs Google ingestion**: Apps Script ACK means **dispatch / script-side success** for the batch the script believes it uploaded — not a guarantee of final Google Ads ingestion (bulk upload can still be reviewed in the Google UI; see `pendingConfirmation` semantics).
- **Safety net**: Stuck **`PROCESSING`** recovery (`recover_stuck_offline_conversion_jobs`, classifier flags) remains the escape hatch when ACK never arrives; **PR-9C invalid-status policy is unchanged**.

### PR-9K — Google Ads Script bulk upload: dispatch ≠ provider confirmed

- **Incident class**: `AdsApp.bulkUploads()` + `upload.apply()` can succeed while Google’s offline conversion import is still **asynchronous / unconfirmed**. **`COMPLETED`** must mean **provider-accepted** (or an explicitly documented terminal), not “CSV applied in-script”.
- **ACK semantics**: `POST /api/oci/ack` treats **`pendingConfirmation: true`** or **`providerConfirmationMode: bulk_upload_async_unconfirmed`** as **dispatch-pending** → seal rows finalize to **`UPLOADED`**, not **`COMPLETED`**. Historical Koç fork (removed; git history) sent both flags after a successful `upload.apply()`.
- **Operator remediation (ledger-only)**: do **not** hand-`UPDATE` `offline_conversion_queue`. Use:
  - **Read-only selector**: `scripts/db/pr9k-select-unconfirmed-script-completed-rows.mjs` (dry-run by default; `OUTPUT_JSON=1`).
  - **Requeue**: `scripts/db/pr9k-requeue-unconfirmed-script-completed-rows.mjs` — dry-run calls `requeue_unconfirmed_script_completed_rows_v1` with `p_apply=false`; apply requires **`APPLY=1`** and **`PR9K_REQUEUE_APPROVAL=I_APPROVE_REQUEUE_UNCONFIRMED_GOOGLE_SCRIPT_COMPLETED_ROWS`** plus **`PR9K_INCIDENT_KEY`**. DB objects: migration **`20261228141500_pr9k_operator_requeue_unconfirmed_google_script_completed.sql`** (`oci_operator_requeue_audit`, FSM session gate **`opsmantik.pr9k_operator_requeue`**, RPCs **`pr9k_unconfirmed_script_completed_candidates_v1`** / **`requeue_unconfirmed_script_completed_rows_v1`**).
- **Post-apply verification**: confirm affected rows are **`RETRY`** / pickable by export; confirm **`oci_operator_requeue_audit`** rows for the incident key; re-run selector with the same window — should return **`PR9K_NO_REQUEUE_CANDIDATES`** for those ids.
- **PR-E evidence strength (follow-up migration `20261229120500_pr9k_provider_evidence_strong_followup_v1.sql`)**: the selector / requeue RPCs treat **`provider_request_id`** as strong exclusion evidence only when it matches **API-shaped** values (standard **UUID** or **`customers/...`** prefixes). **`provider_ref` alone** (common script-side markers) **does not** remove a row from the “unconfirmed script completed” candidate set.
- **Rollback / containment**: pause the Ads schedule; narrow script drain (no broad allowlists); keep **`pendingConfirmation`** path enabled so new runs do not premature-`COMPLETED`.

### PR-9J.CI-AUDIT-P1 — Lifecycle fail-closed closure (code)

- **Junk / reversal invalidation** ([`lib/oci/invalidate-pending-artifacts.ts`](../../lib/oci/invalidate-pending-artifacts.ts)): the same `site_id` + `call_id` scope now includes rows in **`BLOCKED_PRECEDING_SIGNALS`**. They are terminalized to **`FAILED`** via **`append_worker_transition_batch_v2`** with deterministic payload (`CALL_NOT_SENDABLE_FOR_OCI`, `DETERMINISTIC_SKIP`) and **`block_reason` / `blocked_at`** cleared in the ledger snapshot path. This removes a lifecycle leak where blocked rows could survive a call-level junk reversal.
- **ACK SUCCESS `proj_*` / `adj_*`**: missing rows, wrong `export_status` / `status`, or an update row-count mismatch returns **HTTP 409** with stable codes **`ACK_PROJECTION_TARGET_MISMATCH`** / **`ACK_ADJUSTMENT_TARGET_MISMATCH`** — not a silent “already terminal” success. **Deterministic skips** (e.g. `skippedIds`, sampled-out) remain separate from provider failure semantics.
- **ACK_FAILED**: **`proj_*` / `adj_*` are not supported** on this route; the API returns **400** with **`ACK_FAILED_PROJ_ADJ_UNSUPPORTED`** instead of ignoring those IDs.
- **Operator action on 409 mismatch**: inspect the target projection/adjustment row in the DB for the expected pre-state (**`READY`** / **`PROCESSING`**); do not force another ACK until the row matches the script’s actual upload batch.

### PR-9J.CI-AUDIT-P1.1 — Rollout readiness RED_METRIC triage + strict smoke

- **Root cause (evidence `RED_METRIC` before P1.1):** `npm run smoke:oci-rollout-readiness:strict` failed with **`observability_gate_failures_present`** while PR-1C **failed-rate taxonomy** was already correct (e.g. high **`total_failed_rate`** from **`DETERMINISTIC_SKIP`** rows did **not** inflate **`actionable_failed_rate`**). The blocking signal was typically **raw `RETRY / totalQueue`** above **`retryRateMax`** for a site with a large **provider-classified** retry backlog (`provider_error_category` ∈ **`TRANSIENT` / `RATE_LIMIT` / `AUTH`**), not unknown FAILED taxonomy.
- **Taxonomy / gate fix (code):** [`scripts/oci-rollout-readiness.ts`](../../scripts/oci-rollout-readiness.ts) now subtracts those **pipeline-classified RETRY** rows (plus existing **`PROCESSING_STALE_RECOVERY`** grace) from the **retry-rate gate numerator** before comparing to the profile threshold. **`unknown_failed_count > 0`**, **DLQ**, **won missing pipeline**, **stuck processing**, **`actionable_failed_rate`**, and **`provider_failed_rate`** gates are unchanged.
- **Evidence clarity:** [`scripts/release/collect-gate-evidence.mjs`](../../scripts/release/collect-gate-evidence.mjs) re-runs readiness as **`--json`**, parses stable triage, maps failures to narrow **`OCI_ROLLOUT_GATE_*`** reason codes (instead of a generic `RED_METRIC` only), and stores **`metadata.oci_rollout_readiness`** for the markdown artifact.
- **Operator action if strict still fails:** use JSON field **`strict.triage.fleet_gate_site_triage`** (site label + gate failure strings only) to see which invariant fired; for **retry** after P1.1, remaining failures imply **non-pipeline RETRY** (e.g. missing category), **stuck `PROCESSING`**, or another gate — inspect queue rows and cron/recovery posture; do not raise thresholds without incident review.

**Why operators see fewer PEEK rows than QUEUED DB rows (same site):**

1. **Export page size** — One HTTP GET returns at most **`limit`** rows (default up to 250/1000); cursor pagination applies.
2. **Build skips** — Preview diagnostics include **`skip_reason_counts`**, **`skip_by_reason_detail`**, **`skip_by_action`**, **`skip_by_click_id_availability`**: e.g. missing **`call_id`**, invalid time/value, **call not sendable** for OCI, **suppressed_by_higher_gear** (dedupe within a session/call).
3. **Script v1 gclid-only** — Rows with only **wbraid/gbraid** may be **validation-classified** in the production script and never reach **`upload.apply()`** → no Google log line.
4. **`PROCESSING` stuck** — Claimed but not completed rows are **not** in the QUEUED/RETRY export fetch; they will not appear in PEEK until status moves.

**Read-only tools:**

- `node scripts/db/pr9h5b-google-log-visibility-audit.mjs` — queue vs Google log **semantics** + field readiness (booleans only for click ids).
- `node scripts/db/pr9h5b-queue-coverage-audit.mjs` — coverage-style counts after **resolving** `public_id` → `sites.id`.
- `node scripts/db/pr9h6-intent-signal-readiness-audit.mjs` — PR-9H.6 read-only: queue rows by stage/status/action, signal booleans (no raw click ids), provider-path readiness vs **Script v1 (GCLID)** vs future API/EC.
- `node scripts/db/pr9h6-backfill-intents-to-oci-queue.mjs` — **dry-run by default** (calls vs any queue row per `call_id`). **`APPLY=1`** requires **`I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL=I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL`**, **`TARGET_SITE_ID`** (resolvable), **`STAGE_ALLOWLIST`** (e.g. `contacted,offered,won,junk_exclusion`), and **`MAX_ROWS`** (attempt cap). Apply runs `npx tsx scripts/db/pr9h6-backfill-queue-apply.ts` — **no ACK / no upload**; rows tagged `source_type=pr9h6_backfill_queue_apply`.

### Unified intent → OCI queue (PR-9H.6 + PR-9H.6.1)

- Every operator stage must land in **`offline_conversion_queue`** (or explicit `FAILED` / `BLOCKED_*` with reason) — see [`lib/oci/intent-conversion-journal-contract.ts`](../../lib/oci/intent-conversion-journal-contract.ts).
- **PR-9H.6.1:** Won/seal uses the **same** journal helper as micro-stages ([`enqueueSealConversion`](../../lib/oci/enqueue-seal-conversion.ts) → [`enqueueIntentConversionJournalRow`](../../lib/oci/enqueue-intent-conversion-journal-row.ts)).
- **`marketing_signals`** stays audit-only — not upload authority. After an audit insert, [`ensureMarketingSignalQueueParity`](../../lib/oci/marketing-signal-queue-parity.ts) runs **best-effort** from the upsert helpers so the journal is not left behind.
- **Parity read-only checks:** [`lib/oci/intent-queue-parity-guard.ts`](../../lib/oci/intent-queue-parity-guard.ts).
- **Enhanced Conversions** identifiers are stored **hashed only** under `user_identifiers` with consent; normalization: `google_ads_sha256_v1`.
- **Rollout:** keep **sync** on **GCLID-ready** rows through Script v1; journalize wbraid/gbraid-only as blocked until API upload adapter is enabled (separate PR).

**Rollback (backfill apply):** rows created by the tool are identifiable via `source_type=pr9h6_backfill_queue_apply` and the same idempotency keys as product enqueue; rollback is **manual** (do not delete ACK’d / COMPLETED history in production without an incident plan). Prefer **`markAsExported=false` PEEK** plus operator review before relying on apply.

**Koç Oto audit site resolution (example):** `TARGET_SITE_ID=93cb9966bcf349c1b4ece8ea34142ace` **or** UUID `3276893e-0433-4e35-95f2-4e80cf863f4c` after resolving `sites.id` (see **Site identity** above).

### PR-9H.7C — Hashed phone export closure + canary row picker

**HASHED_PHONE_EXPORT_MISSING:** If PEEK returns items with click ids but **no** `hashedPhoneNumber` / `userIdentifiers` while `calls.caller_phone_hash_sha256` exists, verify deploy includes **`fetchExportCallContextRows` progressive projections + dedicated hash merge** (`lib/oci/call-sendability-fetch.ts`) and **`export-fetch` retry without `user_identifiers`** when the column is absent. Final courier fields are attached in **`export-build-queue.ts`** only for valid 64-char lowercase SHA-256 hex.

**Required canary row (Koç / Script v1 hashed-phone CSV):**

- **Currency:** **TRY** (must match `sites.currency`; exclude unexpected-currency rows such as legacy sweep USD drift — see `EXPORT_CLOSURE.md` PR-9H.7C note / row `c84eec78-…`).
- **`status`:** `QUEUED` or `RETRY`.
- **`gclid`:** present (Script v1 path).
- **Hashed phone:** valid queue `user_identifiers` **or** `calls.caller_phone_hash_sha256`.

**Read-only selector:**

```bash
TARGET_SITE_ID=93cb9966bcf349c1b4ece8ea34142ace LIMIT=10 node scripts/db/pr9h7c-select-hashed-phone-canary-row.mjs
```

**Currency anomaly dry-run (sweep USD vs TRY):** `node scripts/db/pr9h7c-currency-anomaly-repair.mjs` — default report-only; apply requires `APPLY=1`, `APPROVAL_TOKEN=I_APPROVE_OCI_CURRENCY_REPAIR`, `TARGET_SITE_ID`, `MAX_ROWS`.

**When to run production `sync`:** only after PEEK/`preview_diagnostics` show **expected** returned rows and stable ACK policy; do not expect the Google upload log to list all **QUEUED** rows.

### PR-9H.7D — Hashed phone export **payload surfacing** (preview courier only)

**Problem:** A canary `offline_conversion_queue` row can be **allowlist-visible** in PEEK while the Google Ads Script still logs **`hp=0`** because the export JSON did not include a **verified** server-side SHA-256 hex in `hashedPhoneNumber` / `userIdentifiers` (courier fields).

**Goal (this PR):** When a valid 64-character hex hash already exists on the journal or on `calls.caller_phone_hash_sha256`, the export item must **surface** `hashedPhoneNumber`, `userIdentifiers` (and optional `user_identifiers` / `hashed_phone_number` mirrors) — **no raw phone**, **no script-side hashing**, **no change** to claim/ACK semantics except richer item JSON.

**Privacy posture:** Raw phone is **never** in `GET /api/oci/google-ads-export` responses. Operators and logs see only **booleans**, **lengths**, **prefix/suffix redaction**, or **safe source enums** in `preview_diagnostics` / `live_diagnostics` — **never** full hash values.

**Expected canary (Koç Oto Kurtarma, read-only PEEK):**

- `sites.public_id`: `93cb9966bcf349c1b4ece8ea34142ace`
- Target `offline_conversion_queue.id`: `a81bec67-3b24-4c27-aa1a-40c7c4ecd0b2`
- `provider_key`: `google_ads`, `markAsExported=false`, allowlist on that queue id, **no** live claim, **no** upload, **no** ACK
- After deploy: script PEEK should be able to show **`hp=1`** (boolean only) when the response includes courier fields; **sync** remains **blocked** until an operator explicitly approves a follow-up canary (separate from this PR).
- `preview_diagnostics` may include **aggregates** such as `hashed_phone_exported_count`, `hashed_phone_missing_count`, `hashed_phone_invalid_count`, `hashed_phone_source_counts` (enum keys only — no hash literals).

**This PR does not** run live export, does not send ACK success, and does not declare production canary completion.

### PR-9H.7E — Hashed-phone canary **closeout** (terminal success, no rerun)

Use this rule after a controlled Koç / Script-lane hashed-phone sync completes.

| Rule | Detail |
|------|--------|
| **Terminal success** | For this script lane, **`offline_conversion_queue.status = COMPLETED`** with **`uploaded_at IS NOT NULL`** is the **terminal success** signal. **An `UPLOADED` ledger row is optional** — many installs go **`PROCESSING` → `COMPLETED`** without an intermediate `UPLOADED` **`new_status`**. |
| **`provider_request_id`** | May remain **`null`** for **Google Ads Script** bulk offline import — Google often does **not** return a REST-style request id. **Do not** treat **`null`** alone as upload failure when **`uploaded_at`** is set and provider error fields are clear. |
| **After terminal success** | **Do not** re-run sync on the **same allowlisted `queue_id`** for “verification” — the row is already **`COMPLETED`**. Further runs require a **new ticket** and typically a **new queue row**. |
| **Recovery** | **Do not** run row-scoped recovery on a **`COMPLETED`** canary target unless product/incident process explicitly requires it. |
| **Evidence package** | Row + ledger prove terminal outcome. **PR-9H.7F** persists **`POST /api/oci/export-run-summary`** into **`public.oci_export_run_summaries`** (counts/metadata only). **`npm run release:evidence:production`** reads **`scripts/sql/export_run_summary_health.sql`** and optional **`OCI_EVIDENCE_*`** targeting. Prefer **pooler/pooled** Postgres URLs via **`scripts/release/resolve-target-db-url.mjs`** ordering. **`TARGET_DB_EVIDENCE_STRICT=1`** must not silently downgrade **`metadata.strict_mode`**. |
| **Promotion language** | **`HASHED_PHONE_CANARY_TERMINAL_SUCCESS`** is **row-scoped**. Do **not** issue an org-wide **production canary success** verdict unless the **full** release/evidence package (including persisted summaries when applicable) passes policy. |

**PR-9C** remains a **separate, invalid** historical canary record — do not conflate with Koç PR-9H.7D/E outcomes.

### PR-9H.7F — Persisted export-run-summary + strict evidence targeting

- **Table:** `public.oci_export_run_summaries` — unique **`(export_run_id, site_id, provider_key)`**; **RLS ON**; **service_role** writes only (see migration **PR-9H.7F**).
- **Health SQL:** `scripts/sql/export_run_summary_health.sql` — wired into **`npm run release:evidence:production`** SQL pack hashes.
- **Targeted canary proof (optional):** set **`OCI_EVIDENCE_EXPORT_RUN_ID`**, **`OCI_EVIDENCE_SITE_ID`**, **`OCI_EVIDENCE_PROVIDER_KEY`** (default **`google_ads`**). With **`TARGET_DB_EVIDENCE_STRICT=1`**, a missing row blocks with **`SCRIPT_SUMMARY_TARGET_MISSING`**.
- **Historical Koç (`PR-9H.7E`):** cannot reconstruct the exact summary without the original HTTP payload — **future** runs must persist summaries for **HASHED_PHONE_CANARY_TERMINAL_SUCCESS_WITH_PERSISTED_SUMMARY**-style closure.

### PR-9I — Universal script drain (GCLID + WBRAID + GBRAID + hashed phone courier)

- **Click identifiers:** the Google Ads Script bulk-upload lane may send **at most one** non-empty click id per CSV row: **Google Click ID** *or* **WBRAID** *or* **GBRAID** — never more than one. **Selected identifier priority** (deterministic): **`gclid > wbraid > gbraid`**. When several are present, only the chosen column is populated; the other two are empty strings.
- **Hashed phone (courier):** if a **server-verified** 64-char lowercase SHA-256 hex exists, it is a **first-class** optional field on the same row (when `OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD=true` and the exact CSV header is configured). **No raw phone** and **no script-side hashing**.
- **Hashed-phone-only rows:** must **not** be marked successful through the **click-id** script lane. They are classified as **not exportable** until a separate proven lane exists.
- **No identifiers:** rows with no usable click id and no valid courier hash for this lane are **not** silently dropped — they are classified and counted in audit/preview.
- **Audit (read-only):** `node scripts/db/pr9i-universal-script-drain-audit.mjs` classifies `QUEUED` / `RETRY` `google_ads` queue rows for **script-mode** sites. It never prints raw gclid/wbraid/gbraid or hash hex.
- **Preview / diagnostics:** hosted preview exposes **count-only** universal drain fields (no click id or hash literals).
- **Persisted summary / evidence:** `oci_export_run_summaries` may include PR-9I counters; reconciliation extends **Eq A–D** with **Eq E–H** when the script payload includes the universal counter bundle (see `lib/oci/export-run-summary-equations.ts`).
- **Canary matrix (operator):** when available, exercise one controlled canary per class: gclid±hp, wbraid±hp, gbraid±hp — each: **PEEK** (booleans only) → **SYNC** with **server allowlist=1** → **DB terminal** + **persisted summary** + **Eq A–H** green — before any site-level broad drain.
- **Broad drain safety:** **no** unbounded “claim everything” without **explicit approval**. A **mutating** export with **no** canary allowlist requires **all** of:
  - Header `x-opsmantik-drain-approval: I_APPROVE_SCRIPT_DRAIN` (or env `OPSMANTIK_DRAIN_APPROVAL`)  
  - `x-opsmantik-drain-site-id` / `OPSMANTIK_DRAIN_SITE_ID` matching the site being exported  
  - `x-opsmantik-drain-max-batch-size` / `OPSMANTIK_DRAIN_MAX_BATCH_SIZE` **≥** requested `limit`  
  - `x-opsmantik-drain-include-braids: true` / `OPSMANTIK_DRAIN_INCLUDE_BRAIDS=true` (acknowledges WBRAID/GBRAID in scope)  
  Failure returns **`409`** with code **`SCRIPT_DRAIN_BLOCKED`**. **Default** production script settings stay safe; canary remains **`limit=1`** with allowlist.
- **Rollback / recovery:** disable optional hashed-phone CSV column; reduce export limit; pause scheduler; re-run audit — treat **`PROCESSING`** stuck rows per existing queue recovery runbooks (do not re-upload blindly).

## Scheduled Google Ads Script Production Sync

**Per-account installation:** one Google Ads Script project (or one MCC-linked script scoped per account) maps to **one** OpsMantik site. Store **`OPSMANTIK_API_KEY`** and **`OPSMANTIK_SITE_ID`** in **Script Properties** (`PropertiesService.getScriptProperties()`); never rely on inline secrets in source. **Canonical paste source:** `scripts/google-ads-oci/GoogleAdsScriptUniversal.js` — paste into the Google Ads Script editor and bind **`main`** to a **time-driven** trigger. (PR-9H.7B canary template strings are frozen in `tests/fixtures/google-ads-oci/PR9H7B_GOOGLE_ADS_SCRIPT_PRODUCTION_SNAPSHOT.js` — **not** a paste target.)

### Script-first enhanced conversions phone hash (PR-9H.7A)

- **never** exposes raw caller phone through `GET .../google-ads-export`; response may include **`hashedPhoneNumber`** (64-char lowercase SHA-256 hex) and **`userIdentifiers`** `{ type: 'hashed_phone', value }` when the journal or `calls.caller_phone_hash_sha256` has a verified hash.
- **Peek** logs **`hasHashedPhoneNumber`** (boolean); **never** logs the hash literal.
- **Bulk offline CSV hashed-phone column** stays **disabled by default.** Enable only after a controlled canary confirms the exact **Google Ads Scripts** CSV header Google accepts:

| Property | Required | Notes |
|---|---|---|
| `OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD` | no | Must be literal `true` to append hashed phone column; absent/false keeps legacy 6-column GCLID CSV |
| `OPSMANTIK_HASHED_PHONE_CSV_COLUMN` | when upload flag is true | Exact column header string (or use inline `HASHED_PHONE_UPLOAD_COLUMN` in the pasted script). If flag is true and both are empty, sync **`throws`** `HASHED_PHONE_COLUMN_NOT_CONFIGURED` |

- **Operational fallback:** hashed phone can remain stored on **`offline_conversion_queue.user_identifiers`** / `calls` even while the script column stays off — courier JSON still carries hashes for parity and future API/upload paths.

### Hashed phone CSV canary (PR-9H.7B — production script)

Purpose: **prove one** Google Ads Scripts `upload.apply()` succeeds with the **exact** optional hashed-phone Bulk Upload column name, using **pre-hashed** payloads from `GET /api/oci/google-ads-export` only — never raw phone and never script-side hashing.

**Phase 1 — PEEK (`OPSMANTIK_RUN_MODE=peek`, `markAsExported=false` implicitly):** confirm a **small** observable set (prefer **one** row via server tools or natural page). `PEEK_ROW` must show `hasGclid: true`, **`hasHashedPhoneNumber: true`**, expected `conversionName` / `conversionTime` / value / currency booleans. Do **not** expect raw phone or hash literals in logs. If `hasHashedPhoneNumber` is false, stop and debug the export chain (`calls.caller_phone_hash_sha256`, `offline_conversion_queue.user_identifiers`, export build, payload shape).

**Phase 2 — Column contract:** set `OPSMANTIK_HASHED_PHONE_CSV_COLUMN` to a **Google-verified** Scripts offline-conversion CSV header. If the exact header is unknown, **do not** run live sync upload. Document the chosen string and evidence in your change record.

**Phase 3 — Controlled sync (single row, server allowlist):** set **all** of the following in Script Properties (never use `OPSMANTIK_DEBUG_ALLOWLIST_IDS` in sync — it remains **forbidden**):

| Property | Required for canary |
|---|---|
| `OPSMANTIK_RUN_MODE` | `sync` |
| `OPSMANTIK_EXPORT_LIMIT` | **`1`** |
| `OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD` | `true` |
| `OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE` | `true` |
| `OPSMANTIK_HASHED_PHONE_CSV_COLUMN` | verified Google CSV header string |
| `OPSMANTIK_EXPORT_ALLOWLIST_IDS` | **exactly one** canonical `offline_conversion_queue.id` |
| `OPSMANTIK_CANARY_EXPECTED_QUEUE_ID` | **must equal** that same UUID |
| `OPSMANTIK_CANARY_APPROVAL` | literal `I_APPROVE_PRODUCTION_CANARY` |
| `OPSMANTIK_CHANGE_TICKET` / `OPSMANTIK_OPERATOR_ID` | set per your change policy (sent as canary headers) |

The script attaches the same **server-side** bundle the API expects (`canaryMode=true`, `allowlist_ids`, approval headers) on the **claim** fetch. It processes **at most one** export page in this mode and aborts if **≠1** returned row.

**Phase 4 — Outcome labels** (see `SYNC_DONE` / `export-run-summary` operational final):

| Label | Meaning |
|---|---|
| `HASHED_PHONE_CSV_CANARY_GREEN` | `upload.apply` + ACK `ok` with `updated >= 1` in hashed-phone CSV canary mode |
| `HASHED_PHONE_CSV_COLUMN_REJECTED` | Google rejected header/value / column contract |
| `HASHED_PHONE_EXPORT_MISSING` | Strict canary: row lacked verified `hashedPhoneNumber` after export |
| `HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE` | Canary bundle invalid or row scope unsafe (e.g. limit≠1, allowlist mismatch, missing approval) |
| `HASHED_PHONE_UPLOAD_SUCCEEDED_ACK_PENDING` | Upload succeeded; ACK did not complete green (same policy as production — do not ACK_FAILED + do not re-upload blindly) |
| `HASHED_PHONE_CANARY_PROVIDER_ERROR` | Upload failed in canary mode for non-column reasons |

**Rollback:** set `OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD=false` (and clear `OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE`) → script returns to **legacy six-column GCLID** CSV behavior.

**Broad rollout:** **not** implied by canary success alone — promote only after product approval, stable Google upload logs, and ACK accounting.

### Currency provenance contract (PR-9H.7B follow-up)

- `offline_conversion_queue.currency` is the primary export currency source; export maps this to `conversionCurrency`.
- `conversionCurrency` must **not** silently fallback to hardcoded `USD` for Turkey sites.
- Sweeper/maintenance enqueue paths must prefer call sale currency (`calls.sale_currency`) and then site currency resolution in enqueue SSOT; do not pass empty currency probes that normalize to neutral USD.
- Export diagnostics now include count-only currency anomaly fields:
  - `currency_missing_count`
  - `currency_unexpected_count`
  - `currency_defaulted_count`
- Canary row selection for Koç (`site_id=3276893e-0433-4e35-95f2-4e80cf863f4c`) should require `currency='TRY'` unless an explicit operator approval exists.

### Script Properties

| Property | Required | Default / notes |
|---|---|---|
| `OPSMANTIK_SITE_ID` | yes | `sites.public_id` or internal site UUID |
| `OPSMANTIK_API_KEY` | yes | OCI API key — set **only** in Script Properties (inline placeholder in repo script is empty) |
| `OPSMANTIK_BASE_URL` | no | `https://console.opsmantik.com` |
| `OPSMANTIK_EXPORT_LIMIT` | no | `50` (capped at 1000 server-side) |
| `OPSMANTIK_RUN_MODE` | no | `peek` \| `sync` \| `ack-repair` |
| `OPSMANTIK_OPERATOR_ID` | no | `google-ads-script` |
| `OPSMANTIK_CHANGE_TICKET` | no | `scheduled-production` |
| `OPSMANTIK_DEBUG_ALLOWLIST_IDS` | no | **Peek only** — client-side filter after a **non-claiming** export. **Forbidden in `sync`:** the script **throws** if this property is set while `OPSMANTIK_RUN_MODE=sync` (prevents claim-then-drop `PROCESSING` rows). |
| `OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE` | no | **PR-9H.7B:** must be `true` when enabling hashed phone CSV in **sync** (with allowlist + approval); see canary section above |
| `OPSMANTIK_EXPORT_ALLOWLIST_IDS` | canary only | **Single** `offline_conversion_queue.id` (comma list with one UUID) |
| `OPSMANTIK_CANARY_EXPECTED_QUEUE_ID` | canary only | Must match `OPSMANTIK_EXPORT_ALLOWLIST_IDS` exactly |
| `OPSMANTIK_CANARY_APPROVAL` | canary only | Literal `I_APPROVE_PRODUCTION_CANARY` |

### First run: PEEK

- Before any upload, set **`OPSMANTIK_RUN_MODE=peek`** and run manually or on a loose schedule. Confirms handshake, export shape, and logs **without** `markAsExported=true` (no queue claim, no Google upload).

### Pilot `sync` (low-risk account)

- Use **one** low-traffic Ads account / site first.
- Set **`OPSMANTIK_EXPORT_LIMIT=10`** for the pilot until logs show stable **SYNC_GREEN** and ACK behavior.
- Then raise the limit toward steady-state.

### Schedule recommendation

- **Production `sync`:** **hourly** per site for pilots and moderate volume (reduces overlap risk vs aggressive schedules). Increase frequency only after stable greens and capacity review — overlapping triggers can cause export contention (`QUEUE_CLAIM_MISMATCH`).
- **`peek`:** ad hoc or hourly for health checks (no claim, no upload).
- **`ack-repair`:** **No-op in the shipped script** until a **server-side** endpoint exists to list ACK-pending rows for scripted repair. Until then, use operator **`POST /api/oci/ack`** / console flows — do not expect `ack-repair` mode to mutate queue state.

### Run labels (operational)

| Label | Meaning |
|---|---|
| **SYNC_GREEN** | Export + upload + ACK completed for the processed rows with **`ok: true`** and **`updated >= 1`** (check logs for `receipt_persist_warning` — non-blocking). **`ok: true`** with **`updated: 0`** is **not** green (script maps to **UPLOAD_SUCCEEDED_ACK_PENDING**). |
| **UPLOAD_SUCCEEDED_ACK_PENDING** | `upload.apply` succeeded but ACK did not complete safely: HTTP/envelope failure, **`ACK_UNKNOWN_PREFIX`**, **`ok: true` / `updated: 0`**, unrecognized ACK body, or a **thrown** error during ACK. **Do not** call **`/api/oci/ack-failed`** for uploaded rows and **do not** re-upload. Use operator ACK with **raw** prefixed ids and the page **`export_run_id`** when **`ack-repair`** is not wired. |
| **CLAIMED_ROW_WITHOUT_ACKABLE_ID** | Claimed page included validation failures with **no** raw export id to ACK-fail — operator/data fix required; not plain green. |
| **UPLOAD_FAILED_PROVIDER_CLASSIFIED** | Google `upload.apply` threw or classified provider failure; script may call **`/api/oci/ack-failed`** for attempted raw ids. |
| **VALIDATION_FAILED_ACK_FAILED** | Row failed pre-upload validation; **`ack-failed`** with `VALIDATION` where raw ids exist. |
| **AUTH_FAILED** | HTTP **401/403** on export or ACK path — fix credentials / handshake. |
| **RATE_LIMITED** | HTTP **429** — backoff and reduce schedule frequency. |

### Upload succeeded + ACK pending (policy)

- If **`upload.apply`** succeeded and **`POST /api/oci/ack`** did not durably confirm (`UPLOAD_SUCCEEDED_ACK_PENDING`), **do not** run **`sync`** again hoping to “fix” ACK — risk of **duplicate offline conversions**. Disable the schedule, reconcile via operator ACK / future repair endpoint.

### Rollback

1. **Disable** the Google Ads Script time-driven trigger for that account.
2. **Do not** re-run **`sync`** for rows where **Google upload already succeeded** but ACK is pending — duplicate offline conversions risk.
3. Until **`ack-repair`** is implemented server-side, use operator **`POST /api/oci/ack`** with **`export_run_id`** and **raw** prefixed queue ids (`seal_*`, etc.).

### Id discipline (PR-9H.4G.3 lessons)

- Export `row.id` may be **`seal_<uuid>`** (or other known prefixes). **`POST /api/oci/ack`** expects those **raw** ids, not the bare UUID.
- **`Order ID`** in the Google bulk CSV must match the **raw** export id used for ACK reconciliation.

## 1. Canary-Ready Rollout Plan (`OCI_PANEL_OCI_FAIL_CLOSED`)

**Current Default Risk:** Currently, `OCI_PANEL_OCI_FAIL_CLOSED` defaults to `false`. This means if the OCI producer fails to persist a durable artifact (outbox row or reconciliation log), the HTTP mutation route still returns a `200 OK`. This creates a silent failure path.

To move to "hardened by default", we must switch this to `true`.

### Rollout Procedure (Canary)

1. **Enable for One Site / Staging First:**
   Set `OCI_PANEL_OCI_FAIL_CLOSED=true` in a staging environment or for a specific canary tenant if environment segmentation allows.
2. **Monitor `panel_oci_partial_failure_total`:**
   Watch this metric closely. If it spikes, it means the producer is failing to write to the database (e.g., due to connection limits or constraint violations).
3. **Monitor HTTP 503 Rates:**
   With fail-closed enabled, these partial failures will now manifest as `HTTP 503 Service Unavailable` on the dashboard.
4. **Rollback Procedure:**
   If user impact is severe and cannot be immediately diagnosed, roll back by setting `OCI_PANEL_OCI_FAIL_CLOSED=false` in the environment variables and redeploying/restarting.
5. **Criteria for Global Default True:**
   - Zero or near-zero `panel_oci_partial_failure_total` over a 7-day period under normal load.
   - All legacy `apply_call_action_v2` coercion bugs are verified fixed.

## 2. Observability Wiring & Critical Metrics

The following metrics must be actively monitored in production dashboards/alerts:

### 2.1 Outbox Health
- **Outbox PENDING Max Age:** The time since the oldest `PENDING` outbox event was created. Alerts should trigger if > 5 minutes.
- **PROCESSING Stuck Count:** Number of events in `PROCESSING` state for > 5 minutes (indicates worker crash or QStash timeout).
- **Worker `PROCESS_OUTBOX_ERROR` Rate:** Error rate from the outbox processor worker.

### 2.2 Producer & API Boundary Health
- **Panel Partial Failure Rate:** Tracks `panel_oci_partial_failure_total` (producer failed, but no fail-closed).
- **`oci_enqueue_ok=false` Count:** Total occurrences where the producer failed to enqueue an artifact.
- **Panel Fail Closed Total:** Tracks `panel_oci_fail_closed_total` (number of times users saw a 503 due to producer failure).

### 2.3 Ledger & Queue Health
- **`BLOCKED_PRECEDING_SIGNALS` Count:** Number of rows in the offline conversion queue blocked waiting for preceding conversion evidence (queue-first; legacy `marketing_signals` consult may remain for compatibility).
- **`BLOCKED` Max Age:** Alerts should trigger if blocked rows age beyond 24 hours (indicates stuck promotion).

### 2.4 Google Ads Sync Health
- **ACK Failed Rate:** Rate of failed acknowledgements from Google Ads scripts.
- **Google Upload Failed Rate:** Tracks explicit failures reported by the Apps Script.
- **`CONVERSION_ACTION_NOT_FOUND` Errors:** Tracks structural mismatches between the SSOT and Google Ads configuration.

### 2.5 Queue lifecycle vs Queue Health 100
- **SSOT doc:** [OCI_QUEUE_LIFECYCLE_CONTRACT.md](../architecture/OCI_QUEUE_LIFECYCLE_CONTRACT.md) — allowed/forbidden transitions, ACK vs ledger-safe writers, `UPLOADED` / `DEAD_LETTER_QUARANTINE` semantics.
- **PR-1C taxonomy:** `FAILED` on the queue is a **state**, not always a provider outage. `DETERMINISTIC_SKIP` + `SUPPRESSED_BY_HIGHER_GEAR` is an **expected** non-upload terminal when lower gears are suppressed; it must remain **visible** in metrics but must **not** drive `provider_failed_rate` / `actionable_failed_rate` alone. Treat **unclassified** FAILED rows (`unknown_failed_count`) as dangerous until triaged.
- **Binding to health “100”:** elevated retry rate, non-zero DLQ, **won pipeline leak**, or **stuck `PROCESSING`** must be interpreted together with lifecycle rules (illegal rewinds, missing ACK receipt idempotency, export-claim mismatch). If `queue_health_score` is GREEN but DB shows long-lived `PROCESSING` without `recover_stuck_offline_conversion_jobs` clearing them, treat as **false green** until TARGET_DB reconciles.
- **False-green ban:** Do not assert perfect queue health from release markdown alone; require `db_evidence_status` / SQL health packs from [OCI_QUEUE_HEALTH.md](../architecture/OCI_QUEUE_HEALTH.md) when claiming production readiness.

### 2.6 Historical rows (no automatic repair in PR-1C)
Older environments may still have rows **`COMPLETED`** with `provider_error_code = SUPPRESSED_BY_HIGHER_GEAR` from before PR-1B. **This PR does not migrate or fix them.** If cleanup is required, run a **separate ops-only** repair with site scope, candidate preview, `CHANGE_TICKET`, `OPERATOR_ID`, an explicit **`--write`** guard, and **no queue row deletion** — mirror the discipline in hardening playbooks; do not ship destructive migrations for this.

## 3. Script-First OCI P0 Reliability Checks

Run these SQL packs during incident triage and pre-release checks:

1. `scripts/sql/rpc_contract_health.sql`
2. `scripts/sql/won_pipeline_health.sql`
3. `scripts/sql/script_backlog_health.sql`
4. `scripts/sql/value_integrity_health.sql`
5. `scripts/sql/identity_integrity_health.sql`
6. `scripts/sql/queue_health.sql` — per-site operational queue invariants (`queue_health_contract_v1`); PR-1C adds taxonomy columns (`deterministic_skip_count`, `actionable_failed_rate`, `provider_failed_rate`, `unknown_failed_count`, …) so deterministic skips are visible but gated separately from provider failures; complements rollout script thresholds in [`lib/oci/queue-health-contract.ts`](../../lib/oci/queue-health-contract.ts).

**Queue health vs conversion economics:** [`queue_health_score`](../../lib/oci/queue-health-contract.ts) is not `lead_score` / conversion value — see [OCI_QUEUE_HEALTH.md](../architecture/OCI_QUEUE_HEALTH.md).

**Future work (separate PRs — do not mix with contract-only releases):** poison-pill / HoL isolation for bad payloads, exponential backoff + jitter on retries, DLQ “autopsy” grouped reports — behavior-changing; tracked outside the measurement contract PR.

Projection contract note:
- `call_funnel_projection` is an active Funnel Kernel read-model table (analytics/metrics/ACK compatibility).
- `rebuild_call_projection` is expected to materialize/update one projection row per `(site_id, call_id)`.
- If `rpc_contract_health.sql` reports `projection_exists=false`, classify as schema drift and apply missing projection-table migration before continuing.

### 3.1 Incident Classification

- **Drift:** `rpc_contract_health.sql` reports missing/signature-drifted RPCs or unsafe grants.
- **Critical migration drift:** target DB evidence marks `DB_SCHEMA_DRIFT` when required migration history/object proof is missing; this is a promotion blocker.
- **Won leak (unrepresented):** `won_pipeline_health.sql` shows `won_missing_unrepresented_count > 0` (alias: `won_missing_pipeline_count`) and non-zero `leak_rate`.
- **Won represented terminal failed:** `won_represented_failed_terminal_count > 0` means row(s) are represented in queue journal but ended in terminal failure taxonomy; this is not an orphan queue-representation leak.
- **Backlog:** `script_backlog_health.sql` shows growing active queue ages/retry counts (Google upload truth). `marketing_signals_pending_count` is legacy/audit pressure unless explicitly promoted by separate policy.
- **Value integrity:** `value_integrity_health.sql` shows abnormal fallback ratio or suspicious zero/null value rows.
- **Identity integrity:** `identity_integrity_health.sql` shows malformed/missing phone hash anomalies.

### 3.2 Stabilization Sequence

1. Freeze risky rollout changes (no API-mode promotion while P0 checks are red).
2. Keep script-mode active.
3. Run `scripts/sql/orphan_won_backfill.sql` in dry-run mode and classify candidates.
4. Repair via existing enqueue SSOT path (`enqueueSealConversion` / sweep cron).
5. Re-run health packs until `won_missing_unrepresented_count = 0` (`won_missing_pipeline_count` alias) and leak rate is `0`.

### 3.3 Rollback Principles

- Do not promote API mode when P0 checks are red.
- Do not delete `offline_conversion_queue` rows during mitigation.
- Prefer additive migrations and deterministic replay over destructive cleanup.

### 3.4 Export Run Integrity

The export run operates under strict rules defined in [OCI_EXPORT_RUN_INTEGRITY_CONTRACT.md](../architecture/OCI_EXPORT_RUN_INTEGRITY_CONTRACT.md).

- **QUEUE_CLAIM_MISMATCH**: This is thrown (HTTP 409) if `fetched_count != claimed_count`. It means another instance grabbed the row, or the row status changed mid-flight. **Action:** Safe to ignore occasionally. If persistent, investigate overlapping script schedules or cron concurrency.
- **EXPORT_RUN_INTEGRITY_UNVERIFIED**: Release evidence will show this until structured logs (`export_run_id`) perfectly connect the script payload summaries with the DB ACKs. **Action:** It means we cannot definitively prove partial run failures aren't happening, but we aren't explicitly failing either. Blocks strict mode promotion without a valid waiver.
- **EXPORT_RUN_INTEGRITY_PARTIAL**: Script summary provided evidence for some equations (e.g. Eq B or C) but missing data prevents full run reconciliation. **Action:** Investigate script summary drops. Blocks strict mode promotion without a valid waiver.
- **EXPORT_RUN_INTEGRITY_RED**: A definitive failure in script summary validation (e.g. `SCRIPT_SUMMARY_INVALID`) or an equation mismatch (e.g. `SCRIPT_CLASSIFICATION_MISMATCH`, `ACK_TOTAL_MISMATCH`). **Action:** This indicates a pipeline bug or an external intervention modifying counts mid-flight. **Hard Blocker** for strict mode promotion.
- **Script Summary Validation (`SCRIPT_SUMMARY_INVALID`)**: Sent by PR-3D endpoint when a script payload does not match schema requirements. Maps to `RED` integrity.
- **Investigating Stuck PROCESSING:** If rows are stuck in `PROCESSING` longer than script execution time, the script crashed post-claim or the ACK endpoint was unreachable. **Action:** `recover_stuck_offline_conversion_jobs` (sweep cron) will safely revert them to `RETRY`. Do NOT manually change statuses.
- **PR-4 Guardrail:** Do **not** blindly move stale `PROCESSING` rows to `RETRY` when provider upload may have happened. Classify first (safe retry vs ambiguous/review).
- **PR-4C Scope:** classifier is available for deterministic decisioning and reporting only; recovery runtime behavior remains unchanged in this phase.
- **PR-4D Mode Flag:** `OCI_PROCESSING_RECOVERY_CLASSIFIER_MODE` controls runtime adoption (`off`, `shadow`, `enforce_safe_retry`, `strict`). Default is non-breaking. Rollback is flag disable (`off`).
- **PR-4D.1 Row-Scoped Recovery RPC:** `recover_safe_processing_queue_rows_v1` is additive and service_role-only. Enforce/strict mode should pass only classifier `SAFE_TO_RETRY` IDs. Legacy broad recovery RPC remains for compatibility in off/shadow mode.
- **PR-4F Grant Hardening:** legacy compatibility RPC `recover_stuck_offline_conversion_jobs` is also service_role-only at grant level (in addition to in-body role guard). `rpc_contract_health.sql` must show no unsafe grants for either recovery mutation RPC.
- **PR-7B Compatibility Contract:** `recover_stuck_offline_conversion_jobs(integer)` is required in target DB evidence. If missing, classify as target DB contract drift (`TARGET_DB_RED`) even when row-scoped recovery smoke is green.
- **PR-7C/7G Won Leak Gate:** `wonMissingPipeline` now means only `won_missing_unrepresented_count` (`no queue representation at all`). Keep it strict; do not relax thresholds to hide true leaks.
- **PR-7G Representation Semantics:** terminal failed won rows (`FAILED`, `DEAD_LETTER_QUARANTINE`, etc.) are represented rows and must stay visible under `won_represented_failed_terminal_count`; do not re-enqueue them as orphan repair.
- **PR-7C Repair Protocol:** run dry-run first (`scripts/sql/orphan_won_backfill.sql` / `scripts/db/repair-orphan-won-queue.mjs` without `--write`), then only site-scoped canonical enqueue repair (`enqueueSealConversion` path) with change ticket + operator provenance.
- **PR-7C Safety Rules:** no queue deletion, no direct SQL value writes, no ad-hoc COMPLETED marking, no broad multi-site blind repair.
- **PR-7D Lock Scope:** `/api/cron/sweep-unsent-conversions` keeps global lock path `sweep-unsent-conversions` for normal runs, but when `site_id` is provided it uses `sweep-unsent-conversions:site:<site_id>`. Manual site repair must include a valid UUID `site_id`; invalid/missing repair `site_id` fails closed (400).
- **PR-7E Lock Diagnostics:** lock skip responses now distinguish backend failures from true contention (`lock_held`, `lock_backend_unavailable`, `lock_rpc_missing`, `lock_acquire_error`) and include `lock_mode`, `lock_backend`, `lock_error_code`, `lock_path`, `lock_ttl_sec`.
- **Migration-history vs object drift:** missing history row and missing runtime object are different failure modes. Equivalent-name resolution is allowed only with explicit object proof; otherwise keep `DB_SCHEMA_DRIFT` red.
- **No manual bypass:** do not manually override `DB_SCHEMA_DRIFT` or drop required migrations from evidence policy to force green.
- **PR-7F Schema Compatibility:** orphan-won sweep/repair does not require `calls.currency`. Missing optional call metadata must not block canonical queue repair; currency fallback stays in app SSOT (`enqueueSealConversion` + site/value policy), with no conversion math fork.
- **PR-4E Strict Gate:** `OCI_RECOVERY_INTEGRITY_STRICT=1` treats recovery integrity as a promotion blocker: ambiguous/unknown/review-required outcomes, enforcement bypass, or missing row-scoped RPC support (in enforce/strict runtime modes) block release unless policy-allowed waiver is explicitly valid.
- **ACK Endpoint Outage:** If Google upload succeeds but `opsmantik/ack` is down, DB can remain `PROCESSING` while provider state is ambiguous. Classify as `ACK_ENDPOINT_UNAVAILABLE_AFTER_UPLOAD` or `UNKNOWN_PROVIDER_OUTCOME`, surface in health/evidence, and require operator review before requeue.
- **Why exactly-once isn't assumed:** Network partitions mean we can never guarantee script ↔ backend ACKs complete perfectly. We rely on deterministic IDs (`external_id`) and idempotent DB RPCs to self-heal.
- **Correlating Lineage:** Search structured logs for `export_run_id`. It ties together `EXPORT_RUN_FETCHED`, `EXPORT_RUN_CLAIMED`, `EXPORT_RUN_RESPONSE_BUILT`, `EXPORT_RUN_ACK_RECEIVED`, and `SCRIPT_SUMMARY_RECEIVED`. This ID is strictly for debugging lineage and has no effect on actual conversion identity.

### 3.5 Strict Mode Promotion & Waivers
When promoting to staging or production under strict mode (`OCI_EXPORT_RUN_INTEGRITY_STRICT=1`):
1. The pipeline must report `EXPORT_RUN_INTEGRITY_GREEN` to pass automatically.
2. If the pipeline reports `UNVERIFIED` or `PARTIAL` (e.g., summary drops or partial tracking), you MUST provide a valid waiver.
3. **Waiver Format**: Export the following variables:
   - `OCI_EXPORT_RUN_WAIVER_OWNER`
   - `OCI_EXPORT_RUN_WAIVER_REASON`
   - `OCI_EXPORT_RUN_WAIVER_EXPIRY` (ISO string, future date)
   - `OCI_EXPORT_RUN_WAIVER_BLAST_RADIUS`
4. If the integrity is `RED` (equation mismatch or invalid summary), the release is **blocked** and cannot be waived. Rollback or freeze the release immediately until the pipeline bug is addressed.

### 3.6 First 5 Minutes: Stuck PROCESSING Incident Protocol

1. Check queue health for `stuck_processing_count` and `oldest_processing_age_minutes`.
2. Inspect `export_run_id` evidence/log lineage for affected rows.
3. Confirm script summary presence (`SCRIPT_SUMMARY_MISSING` is never green in strict mode).
4. Correlate ACK / ACK_FAILED logs and receipts for the same run.
5. Classify each row: `SAFE_TO_RETRY` vs ambiguous/review buckets.
6. Never blindly update `PROCESSING` to `RETRY` if provider upload may have occurred.

PR-4D follow-up: adopt classifier output in recovery cron/RPC transitions with rollout guards.

Implementation note: if row-scoped recovery RPC is missing/unavailable, enforce/strict mode must report `RECOVERY_ROW_SCOPED_RPC_MISSING` and must not falsely claim enforcement.
Rollback path for recovery strict gate: set `OCI_PROCESSING_RECOVERY_CLASSIFIER_MODE=off` and/or set `OCI_RECOVERY_INTEGRITY_STRICT=0`.

### 3.7 PR-6 Target DB Evidence (No False Green)

1. Run `npm run release:evidence` for static contract proof (`TARGET_DB_NOT_CHECKED` is expected in static mode).
2. For staging/production promotion, run DB-connected evidence mode with target DB env (`SUPABASE_DB_URL` or `DATABASE_URL`).
3. Treat `DB_ENV_MISSING`, `DB_QUERY_FAILED`, `DB_RPC_MISSING`, `DB_RPC_SIGNATURE_DRIFT`, and `DB_UNSAFE_GRANT` as blockers in strict target mode.
4. Verify row-scoped recovery smoke (`recover_safe_processing_queue_rows_v1` empty-array call) is `TARGET_DB_GREEN` or explicitly `SMOKE_UNVERIFIED` with reason.
5. Read `tmp/db-evidence-latest.json` and `tmp/release-gates-latest.json` together; static green alone is not promotion green.
6. Placeholder/invalid DB URLs are rejected (`DB_URL_INVALID`) before connection attempts (`<...>`, `BURAYA`, redacted/example placeholders).
7. DB evidence failures still write fresh artifacts (`is_fresh_artifact: true`) to avoid stale snapshot confusion.
8. Failure meanings:
   - `DB_ENV_MISSING`: DB URL not provided.
   - `DB_URL_INVALID`: malformed or placeholder URL.
   - `DB_CONNECTION_FAILED`: connection setup failed.
   - `DB_QUERY_FAILED`: DB connected but pack/query execution failed.
9. `target_db_checked` is the canonical PR-6 proof flag. Do not infer target DB proof from legacy preflight checks.
10. `legacy_verify_db_checked` (if present) only indicates legacy `verify-db` command execution; it is separate from target DB SQL-pack/RPC proof.
11. Queue-only deployments may not have `public.marketing_signals`; this must be classified as `LEGACY_RESIDUE_ABSENT` / `AUDIT_TABLE_NOT_PRESENT` and must not crash SQL packs.
12. Required queue/recovery RPC drift is still a hard blocker; only legacy marketing-signal RPCs can be treated as optional residue checks.
13. Every evidence run must overwrite both mode-specific and latest artifacts (`release-gates-<mode>.md/json` and `release-gates-latest.md/json`) with matching `generated_at` and `mode`.

### 3.8 Production Export Freeze (No Live Export Drill)

Purpose: stop new provider upload attempts while keeping ACK/ACK_FAILED idempotent reconciliation path available.

Freeze steps:
1. Announce freeze owner + timestamp + deploy SHA.
2. Stop new claim/upload schedulers for export surfaces (no new Google export attempts).
3. Keep ACK/ACK_FAILED endpoints available; ACK replay remains idempotent and authorized-only.
4. Capture queue snapshot (`PROCESSING`, `RETRY`, `FAILED`, `DLQ`) and export-run lineage evidence.
5. Run read-only production evidence and archive artifacts before unfreeze.

Unfreeze prerequisites:
1. `target_db_checked=true` and `target_db_contract_status=TARGET_DB_GREEN`.
2. No active P0/P1 blockers in release evidence.
3. Stuck `PROCESSING` rows are classified (`SAFE_TO_RETRY` vs ambiguous/review).
4. Freeze checklist record is complete and signed by release owner.

Allowed actions during freeze:
- freeze export claims/uploads,
- read-only evidence collection,
- ACK replay via idempotent authorized endpoint flow,
- row-scoped safe recovery using `recover_safe_processing_queue_rows_v1` for classifier `SAFE_TO_RETRY`,
- operator review for ambiguous/unknown outcomes.

Forbidden actions during freeze:
- no queue row delete,
- no manual COMPLETED,
- no direct status SQL update,
- no direct value rewrite,
- no force unlock without stale-lock evidence,
- no blind `PROCESSING -> RETRY`.

### 3.9 Rollback Scenario Matrix

Evaluate at minimum:
- bad deploy before export claim,
- bad deploy after claim before provider upload,
- bad deploy after provider upload before ACK,
- ACK endpoint unavailable,
- provider ambiguous response,
- row-scoped classifier blocks retry,
- production evidence turns red post-deploy,
- stuck `PROCESSING` after script/runtime crash.

For each scenario record: trigger, scope, freeze decision, rollback action, verification command, post-rollback evidence artifact.

### 3.10 Production Rollback Checklist Record

Every production rollback/freeze drill record must include:
- owner,
- timestamp,
- deploy commit,
- target DB evidence artifact paths (`tmp/release-gates-production.*`, `tmp/db-evidence-latest.*`),
- queue snapshot reference,
- export run IDs (if present),
- affected site/provider scope,
- rollback action executed,
- verification command output reference,
- post-rollback evidence result.

### 3.11 Production Canary Preview Gate (PR-9)

- A zero-item preview (`markAsExported=false`) is a hard blocker for first live canary export.
- PR-9C may proceed only after a site-scoped preview demonstrates `item_count > 0` with `markAsExported=false`.
- First canary should prefer positive exportable rows (`OpsMantik_Contacted`, `OpsMantik_Offered`, `OpsMantik_Won`) unless `OpsMantik_Junk_Exclusion` handling is explicitly verified for the selected script/account.
- For first canary stage-gate, treat the current export path as effectively seal/won-gated until `OpsMantik_Offered` and `OpsMantik_Contacted` are explicitly proven buildable in preview.
- `OpsMantik_Junk_Exclusion` is not an acceptable first-canary payload unless buildable preview evidence is captured and operator-approved.
- Before PR-9C, preview output must expose skip/drop diagnostics (`fetched_count`, `buildable_count`, `returned_count`, `skipped_count`, `skip_reason_counts`) so row loss can be classified without mutating production.
- During PR-9B diagnostics, never switch to `markAsExported=true`, never claim rows, and never perform live upload attempts.
- PR-9E hardening: canary live export must run through guarded canary wrapper (`scripts/db/oci-canary-live-export.mjs`) and must fail-closed before any live claim when required metadata is missing.
- PR-9H.4A: wrapper pre-live gate mirrors `scripts/db/pr9h-preview.mjs` / `scripts/db/lib/oci-canary-preview-walk.mjs`: bounded **`next_cursor`** preview (`markAsExported=false`, exact `CANARY_EXPECTED_QUEUE_ID`) before **`--live`**. Use **`--dry-run`** for non-mutating parity proof (`markAsExported` remains false).
- PR-9H.4D: canary live claim requires explicit single-row allowlist in canary mode (`x-opsmantik-allowlist-ids` / `allowlistIds`), and the allowlist id must equal `CANARY_EXPECTED_QUEUE_ID`.
- PR-9H.4D: for canary mode, server fetch must be row-scoped by allowlist id (`offline_conversion_queue.id in allowlist`) before claim.
- PR-9H.4D: operator-driven Google sync must require `CANARY_UPLOAD_APPROVAL=I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD` and must not continue to broad pagination after the allowlisted row is processed.
- Required canary metadata for live call: `CHANGE_TICKET`, `OPERATOR_ID`, `CANARY_APPROVAL=I_APPROVE_PRODUCTION_CANARY`, `CANARY_SITE_ID`, `CANARY_MAX_BATCH_SIZE=1`, `CANARY_EXPECTED_QUEUE_ID`.
- If `stuck_processing` increased after preflight baseline, live canary additionally requires `CANARY_REAPPROVAL=I_REAPPROVE_WITH_STUCK_PROCESSING_INCREASE`.
- Canary live call uses opt-in headers (`x-opsmantik-canary-*`) so non-canary exports remain unaffected.
- Canary live claim must fail-closed when claimed queue id is not exactly `CANARY_EXPECTED_QUEUE_ID`.

### PR-9H.4F — Hosted parity, localhost ban, recovery

- **No localhost for production canary claims:** `oci-canary-live-export.mjs --live` **must not** use `APP_BASE_URL=http://localhost:*` — the wrapper fails closed with `LOCALHOST_LIVE_CANARY_FORBIDDEN`.
- **Hosted `APP_BASE_URL` for live:** set `APP_BASE_URL=https://console.opsmantik.com` for any operator **mutating** canary export (`--live`); `--dry-run` may still be used against local dev when debugging route code only.
- **Hosted allowlist dry-run gate:** before any future **live** allowlisted upload (PR-9H.4G), run **`--dry-run`** with **`OPSMANTIK_ALLOWLIST_IDS`**, allowlist header/query, and **`CANARY_*` metadata** against the **hosted** origin. If the preview gates emit **`PREVIEW_UNEXPECTED_SINGLETON_ROW`**, classify **`HOSTED_ALLOWLIST_PARITY_FAILED`** and **do not** proceed to live claim — deploy the allowlist journal filter revision first.
- **Claimed-not-uploaded recovery:** use **`scripts/db/pr9h4c-recover-claimed-not-uploaded.mjs`** only with **`CANARY_INCIDENT_RECOVERY_APPROVAL=I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_CLAIMED_NOT_UPLOADED`**, fixed Muratcan **`RECOVERY_TARGET_*`**. **`RECOVERY_MIN_AGE_MINUTES`** must be a **positive** integer (RPC stale gate uses **at least 1 minute**); `0` falls back to the script default (**15**). Use **`1`** when the row is stale enough for RPC but younger than 15 minutes.
- **PR-9H.4F non-goals:** no `markAsExported=true` outside the guarded wrapper, no broad recovery, no manual `COMPLETED`, no queue delete, no fake ACK — PR-9C remains invalid and separate.


## 4. Conversion Math SSOT and Value Drift

Canonical conversion names:
- `OpsMantik_Contacted`
- `OpsMantik_Offered`
- `OpsMantik_Won`
- `OpsMantik_Junk_Exclusion`

Canonical policy module:
- `lib/oci/marketing-signal-value-ssot.ts`

Policy version:
- `oci_conversion_value_policy_v1`

Run value drift checks:
1. `scripts/sql/value_integrity_health.sql`
2. `scripts/sql/conversion_value_policy_repair_playbook.sql` (dry-run candidates)

GREEN/RED interpretation:
- GREEN: `drifted_rows = 0` for active sites.
- RED: any non-waived drift rows > 0.

Dry-run repair flow:
1. Run playbook dry-run and pick one site as canary.
2. Repair through app SSOT paths when possible (enqueue/upsert flows).
3. If emergency write is unavoidable, tag provenance fields (`value_repair_reason`, `value_policy_version`, `value_repaired_at`, `value_repaired_by`).
4. Re-run health SQL and verify drift is cleared.

Hard rules:
- Never delete queue rows during mitigation.
- Value policy changes must ship as one PR containing code + migration + health SQL + tests.
