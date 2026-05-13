# Export closure — formal design (implementation index)

This document is the **R1 (öz)** contract for the kapalı export journal: **one** upload truth surface — [`offline_conversion_queue`](../../supabase/migrations/20260502120000_ensure_oci_queue_and_signals.sql) — plus four canonical conversion names in [`lib/oci/conversion-names.ts`](../../lib/oci/conversion-names.ts).
`offline_conversion_queue` is the only runtime Google upload journal.
The Google Ads **script/API export route does not read `marketing_signals`**. **R2** = code links; **R3** = tests + SQL + `npm run test:release-gates` + [`scripts/release/evidence-contracts.mjs`](../../scripts/release/evidence-contracts.mjs) health packs.

## PR-9H.6 — Unified intent → queue journal + full Google signal readiness

- **Contract:** [`lib/oci/intent-conversion-journal-contract.ts`](../../lib/oci/intent-conversion-journal-contract.ts) — canonical stages (`contacted` / `offered` / `won` / `junk_exclusion`), conversion names, provider paths (`google_ads_script_v1`, `google_ads_api_click_conversion`, `google_ads_api_enhanced_conversions_leads`), and deterministic disposition for consent / sendability / click vs enhanced signals.
- **Enqueue:** [`lib/oci/enqueue-intent-conversion-journal-row.ts`](../../lib/oci/enqueue-intent-conversion-journal-row.ts) — micro-stages delegate from [`enqueue-oci-conversion-row.ts`](../../lib/oci/enqueue-oci-conversion-row.ts); seal path stamps `provider_path`, `source_type`, `source_idempotency_key`.
- **User identifiers:** [`lib/oci/google-ads-user-identifier-normalization.ts`](../../lib/oci/google-ads-user-identifier-normalization.ts) — SHA-256 after normalization; **never** store raw phone/email on `user_identifiers` JSONB; consent gates required before hashing.
- **Script v1 vs API:** Canonical fleet script [`GoogleAdsScriptUniversal.js`](../../scripts/google-ads-oci/GoogleAdsScriptUniversal.js) maps **one** click-id column per CSV row (gclid > wbraid > gbraid). Quarantined [`GoogleAdsScriptProduction.js`](../../tests/fixtures/google-ads-oci/PR9H7B_GOOGLE_ADS_SCRIPT_PRODUCTION_SNAPSHOT.js) documents legacy **GCLID-first** bulk CSV + PR-9H.7B canary tokens for archival comparison. wbraid/gbraid-only rows may still be `BLOCKED_PRECEDING_SIGNALS` where API-only paths apply — see stub [`lib/providers/google-ads-api/conversion-upload-adapter.ts`](../../lib/providers/google-ads-api/conversion-upload-adapter.ts).
- **Diagnostics:** PEEK `preview_diagnostics` includes `signal_availability_counts`, `script_v1_supported_counts`, `api_supported_counts`, `skip_by_provider_path` — **no raw click ids or PII**.
- **Read-only audit:** `node scripts/db/pr9h6-intent-signal-readiness-audit.mjs` (resolve `public_id` → `sites.id` first).

## PR-9H.7A — Script-first enhanced conversions phone hash (courier-only)

- **Raw phone never reaches the Google Ads Script.** The script is a **transport-only** carrier for values the backend has already normalized and hashed.
- **Backend SSOT:** [`lib/oci/validation/crypto.ts`](../../lib/oci/validation/crypto.ts) — `normalizePhoneToE164` (default `+90` / TR) → **UTF-8** `crypto.createHash('sha256').update(normalizedE164WithPlus).digest('hex')` (lowercase 64-char). Ingestion also funnels through [`lib/dic/phone-hash.ts`](../../lib/dic/phone-hash.ts) for `calls.caller_phone_hash_sha256`.
- **Queue:** `offline_conversion_queue.user_identifiers` may include `hashed_phone`, `normalization_version` (`e164_sha256_v1`), and `source` (e.g. `caller_phone_hash_sha256`) — **never** raw phone in this JSON ([`enqueue-intent-conversion-journal-row.ts`](../../lib/oci/enqueue-intent-conversion-journal-row.ts)).
- **Export JSON** ([`export-build-queue.ts`](../../app/api/oci/google-ads-export/export-build-queue.ts)): each item may include **`hashedPhoneNumber`** (valid hex only), **`hashed_phone_number`** (same value, legacy key), and **`userIdentifiers`** with `{ type: 'hashed_phone', value }`. **PR-9H.8:** journal fetch is **`fetch_oci_google_ads_export_jit_v1`** — one atomic SQL read joins `offline_conversion_queue`, `calls`, and `sessions`; `sessions.consent_scopes` must include **`marketing`** or hashed identifiers and `caller_phone_hash_sha256` are stripped in SQL before Node. Resolution order after gate: queue `hashed_phone` / `hashedPhoneNumber` → `jit_caller_phone_hash_sha256` (call hash only when marketing consent). Invalid hex increments diagnostics only (`hashed_phone_invalid_count`); Zod armor on the final item enforces `/^[a-f0-9]{64}$/` before JSON response.
- **Preview diagnostics** ([`route.ts`](../../app/api/oci/google-ads-export/route.ts)): `hashed_phone_available_count`, `hashed_phone_invalid_count`, `enhanced_signal_available_count` — counts only (no hashes).
- **Canonical fleet script:** [`GoogleAdsScriptUniversal.js`](../../scripts/google-ads-oci/GoogleAdsScriptUniversal.js) reads `hashedPhoneNumber` / `userIdentifiers` (never hashes raw phone, never logs hash literals). Optional CSV column via `INCLUDE_HASHED_PHONE` / `HASHED_PHONE_COLUMN` + Script Properties (`OPSMANTIK_INCLUDE_HASHED_PHONE`, `OPSMANTIK_HASHED_PHONE_COLUMN`). **Quarantined** [`GoogleAdsScriptProduction.js`](../../tests/fixtures/google-ads-oci/PR9H7B_GOOGLE_ADS_SCRIPT_PRODUCTION_SNAPSHOT.js) retains PR-9H.7B canary bundle strings for historical template comparison (`OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD`, canary approval headers). Until product re-ports canary into Universal, treat Production-only canary docs as archive reference — live paste target is Universal.

## PR-9H.7C — Hashed phone export closure + canary candidate selector

### HASHED_PHONE_EXPORT_MISSING (remediation)

**Symptom:** Hosted `GET /api/oci/google-ads-export` (`markAsExported=false` PEEK) returns conversion rows **without** `hashedPhoneNumber`, `hashed_phone_number`, or `userIdentifiers`, even though `calls.caller_phone_hash_sha256` is populated (64-char lowercase hex) for the row’s `call_id`.

**Actual build path (hosted = repo route):**

`app/api/oci/google-ads-export/route.ts` → `fetchExportData` (`export-fetch.ts`) → **`adminClient.rpc('fetch_oci_google_ads_export_jit_v1')`** (atomic queue + calls + sessions + JIT consent gate) → `parseJitExportRpcRowsStrict` ([`google-ads-hashed-identifiers.zod.ts`](../../lib/oci/validation/google-ads-hashed-identifiers.zod.ts)) → `buildExportItems` (`export-build-items.ts`) → `buildJitMapsFromRows` + `buildQueueItems` (`export-build-queue.ts`). Final JSON shape is produced in **`export-build-queue.ts`** (`GoogleAdsConversionItem`).

**Root causes addressed in PR-9H.7C + PR-9H.8:**

1. **Call-context SELECT brittleness** — (Legacy) If the wide `calls` projection failed, the exporter could drop call context. **PR-9H.8** removes the second round-trip: call columns are selected in the same snapshot as the queue slice via the JIT RPC.
2. **`offline_conversion_queue.user_identifiers` drift** — Older DBs may omit the column; the JIT RPC selects `user_identifiers` as stored (gated in SQL when marketing consent is absent).

**Never emitted:** raw phone / normalized E.164 / any non–SHA-256-hex phone fields — only `/^[a-f0-9]{64}$/` passes through.

**Canary candidate selection (read-only):** `node scripts/db/pr9h7c-select-hashed-phone-canary-row.mjs` with `TARGET_SITE_ID` / `OPSMANTIK_SITE_ID` resolved via `scripts/db/lib/resolve-site-identity.mjs`. Filters **QUEUED/RETRY**, **google_ads**, **currency == site currency** (or `EXPECTED_CURRENCY`), **non-empty gclid** (Script v1), **positive `value_cents`** (optional zero junk via `ALLOW_ZERO_JUNK_VALUE=1`), **conversion_time**, **valid hash** from queue JSON **or** `calls.caller_phone_hash_sha256`. Output is **metadata-only** (queue UUID tail-safe full UUID allowed — operator uses id for allowlist; script never prints gclid/hash).

**Currency anomaly (legacy sweep row):** Example queue id `c84eec78-e041-4922-b088-697dabdde161` carried **`currency=USD`** while **`calls.sale_currency`** and **`sites.currency`** were **TRY**, due to **`entry_reason=sweep_unsent_conversions`** enqueue normalizing an empty currency string. Sweep/maintenance paths now prefer **`calls.sale_currency`**. That row remains **unsuitable for hashed-phone CSV canary** until currency matches site (**TRY** for Koç). Optional dry-run reporter: `node scripts/db/pr9h7c-currency-anomaly-repair.mjs`.

## PR-9H.7B — Hashed phone CSV canary (script + server allowlist)

- **Sync with hashed phone CSV** requires **`OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE=true`**, **`OPSMANTIK_EXPORT_LIMIT=1`**, a **single** `offline_conversion_queue.id` in `OPSMANTIK_EXPORT_ALLOWLIST_IDS` matching `OPSMANTIK_CANARY_EXPECTED_QUEUE_ID`, and approval header token `I_APPROVE_PRODUCTION_CANARY` — same contract as [`export-auth.ts`](../../app/api/oci/google-ads-export/export-auth.ts) canary guards when **`markAsExported=true`**. Missing any piece fails closed (`HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE`).
- Operational narrative: [`docs/runbooks/OCI_HARDENING_OPERATIONS.md`](../../docs/runbooks/OCI_HARDENING_OPERATIONS.md) **Hashed phone CSV canary (PR-9H.7B)**.

## Currency provenance (queue → export)

- Queue row currency is authoritative for export payload (`offline_conversion_queue.currency` → `conversionCurrency`).
- Export no longer silently falls back to neutral `USD` when both queue and site currency are absent; such rows are blocked and counted in diagnostics.
- Count-only preview diagnostics include `currency_missing_count`, `currency_unexpected_count`, `currency_defaulted_count`.
- Repair/sweeper enqueue paths should pass `calls.sale_currency` where available and rely on site currency fallback inside enqueue SSOT instead of empty-string neutralization.

## PR-9H.6.1 — Producer wiring completion + parity guard

- **Won / seal** now shares the same SSOT insert as micro-stages: [`enqueueSealConversion`](../../lib/oci/enqueue-seal-conversion.ts) delegates to [`enqueueIntentConversionJournalRow`](../../lib/oci/enqueue-intent-conversion-journal-row.ts) with a **precomputed disposition** (precursor gate, consent, Script v1 vs wbraid/gbraid) plus legacy **fast-track** dedupe (`oci-v5-fasttrack-${queue_id}`) when `oci_sync_method=api` and status is `QUEUED`.
- **`marketing_signals`** remains **audit-only**. Any live write through [`lib/oci/upsert-marketing-signal.ts`](../../lib/oci/upsert-marketing-signal.ts) / domain twin **best-effort invokes** [`ensureMarketingSignalQueueParity`](../../lib/oci/marketing-signal-queue-parity.ts) so every hash/audit row gets a matching journal attempt (idempotent on `source_idempotency_key`).
- **Parity diagnostics (read-only):** [`lib/oci/intent-queue-parity-guard.ts`](../../lib/oci/intent-queue-parity-guard.ts) — `QUEUE_ROW_*` outcomes for audits/tests; **no DB writes**.
- **Exact-site backfill (APPLY):** `node scripts/db/pr9h6-backfill-intents-to-oci-queue.mjs` delegates to [`scripts/db/pr9h6-backfill-queue-apply.ts`](../../scripts/db/pr9h6-backfill-queue-apply.ts) when `APPLY=1` + **`STAGE_ALLOWLIST`** + **`MAX_ROWS`** + approval token match. Tags rows with `source_type=pr9h6_backfill_queue_apply` (no upload / no ACK from the tool).

### Producer map (first-class intent → journal)

| Source | Stage(s) | Queue path | Notes |
|--------|-----------|------------|--------|
| [`process-outbox.ts`](../../lib/oci/outbox/process-outbox.ts) | contacted / offered / junk | `enqueueOciConversionRow` → journal | Outbox is primary panel/cron fan-in |
| [`stage-router.ts`](../../lib/domain/mizan-mantik/stages/stage-router.ts) | contacted / offered / junk (sync) | `ensureMarketingSignalQueueParity` | Won **dropped here** by design (seal-owned) |
| [`enqueue-seal-conversion.ts`](../../lib/oci/enqueue-seal-conversion.ts) | won | Seal → **journal** (`OpsMantik_Won`) | Fast-track only on API + `QUEUED` |
| [`sweep-unsent-conversions`](../../app/api/cron/sweep-unsent-conversions/route.ts) | won | `enqueueSealConversion` | Repair / orphan fill |
| [`lib/oci/upsert-marketing-signal.ts`](../../lib/oci/upsert-marketing-signal.ts) + domain twin | non-won audit | `marketing_signals` INSERT + **parity enqueue** | Audit residue, not export authority |

## Single export surface (journal SSOT)

| Path | Role |
|------|------|
| Script batch | [`GET .../google-ads-export`](../../app/api/oci/google-ads-export/route.ts) → [`fetchExportData`](../../app/api/oci/google-ads-export/export-fetch.ts) (**`fetch_oci_google_ads_export_jit_v1`**) → `buildExportItems` → highest-gear dedupe within journal |
| API worker lane | Same journal rows uploaded by worker/kernel; fast-track via QStash when `oci_sync_method=api` |

**Legacy `marketing_signals`:** It is an **ACTIVE_RUNTIME_RESIDUE** that still receives writes for non-won stages, but it is **not** combined into the Google export batch. It is not an upload authority and must be treated as an audit-only shadow trail. Stranded PENDING rows are an operational cleanup topic (pulse/recovery), not a second upload authority.
Parity hardening rule: for Google-eligible `marketing_signals` writes, a matching `offline_conversion_queue` row is required (`marketing_signals_queue_parity_gap_count` must remain `0` in health/evidence). DB trigger lane now records violations into `parity_audit_log` / `parity_violation_dlq`; enforcement mode is controlled by `app.settings.oci_marketing_signal_queue_parity_enforcement` (`observe` default, `enforce` optional).

## Four conversion matrix (lifecycle → journal)

| Stage | `action` / Google name | Emit path | Notes |
|-------|------------------------|-----------|--------|
| junk | `OpsMantik_Junk_Exclusion` | IntentSealed `outbox_events` → [`runProcessOutbox`](../../lib/oci/outbox/process-outbox.ts) → [`enqueueOciConversionRow`](../../lib/oci/enqueue-oci-conversion-row.ts) → [`enqueueIntentConversionJournalRow`](../../lib/oci/enqueue-intent-conversion-journal-row.ts) | Junk reversal may enqueue [`conversion_adjustments`](../../lib/oci/outbox/process-outbox.ts) retractions |
| contacted | `OpsMantik_Contacted` | same | Single-conversion gear rank suppresses lower stages when higher exists |
| offered | `OpsMantik_Offered` | same | |
| won | `OpsMantik_Won` | Outbox won branch → [`enqueueSealConversion`](../../lib/oci/enqueue-seal-conversion.ts) → [`enqueueIntentConversionJournalRow`](../../lib/oci/enqueue-intent-conversion-journal-row.ts); seal / sweep paths also | Precursor + consent + Script v1 gating; `provider_path`, `source_type`, `source_idempotency_key` (PR-9H.6 / 6.1) |

**Intent-only Ads conversion:** no separate “raw intent” conversion action in the closed-system path; optional panel precursor is gated by `OCI_INTENT_PANEL_PRECURSOR_CONTACTED_ENABLED` (see [`enqueue-panel-stage-outbox.ts`](../../lib/oci/enqueue-panel-stage-outbox.ts)).

## Queue-only upload path audit matrix

| Conversion | Current producer | Current table | Current upload path | Should be queue? | Double-path risk | Class | Action |
|---|---|---|---|---|---|---|---|
| contacted | `runProcessOutbox` / stage-router fire | `offline_conversion_queue` (plus legacy `marketing_signals` audit writes) | `google-ads-export` reads queue only | yes | legacy audit write can confuse ops if treated as upload | `QUEUE_CANONICAL` + `AUDIT_ONLY` | keep queue as authority; treat `marketing_signals` as non-upload lane |
| offered | `runProcessOutbox` / stage-router fire | `offline_conversion_queue` (plus legacy `marketing_signals`) | queue-only fetch | yes | same as contacted | `QUEUE_CANONICAL` + `AUDIT_ONLY` | same |
| won | seal/outbox/sweep enqueue | `offline_conversion_queue` | queue-only fetch | yes | low (won already queue authority) | `QUEUE_CANONICAL` | keep helper-only writes |
| junk exclusion | `runProcessOutbox` micro-stage path (with optional retraction adj records) | `offline_conversion_queue` | queue-only fetch | yes | medium if old signal-only assumptions linger | `QUEUE_CANONICAL` | keep queue authority; preserve explicit blocked/skip semantics |

`marketing_signals` classification in this contract: **`ACTIVE_RUNTIME_RESIDUE`** / **`AUDIT_ONLY`** (legacy/hash/recovery/evidence), **not** an independent Google upload source.

## Formal invariant index (I1–I13)

| ID | Scope | Rule (summary) | Pointer |
|----|-------|----------------|---------|
| **I1–I8** | Score / tenant / value | Closed-system gates G1–G5; tenant scope; economics SSOT | [`CLOSED_SYSTEM_SCORE_CONTRACT.md`](./CLOSED_SYSTEM_SCORE_CONTRACT.md), [`queue-health-contract.ts`](../../lib/oci/queue-health-contract.ts) |
| **I9** | Four-fire → journal | Canonical stage emit → `offline_conversion_queue` row or explicit structured blocked outcome (e.g., `FAILED` + `DETERMINISTIC_SKIP` or generic `BLOCKED`) — **no silent skip** when stage is considered fired | [`enqueue-oci-conversion-row.ts`](../../lib/oci/enqueue-oci-conversion-row.ts), [`enqueue-seal-conversion.ts`](../../lib/oci/enqueue-seal-conversion.ts) |
| **I10** | Determinism | `external_id` shape + uniqueness — drift = deploy STOP | [`external-id.ts`](../../lib/oci/external-id.ts), migration [`20260507121500_oci_queue_external_id_shape_guard.sql`](../../supabase/migrations/20260507121500_oci_queue_external_id_shape_guard.sql) |
| **I11** | Layer closure | L1–L4 stack: identity → policy → orchestration → evidence | Sections **L × W** and **D1–D11** below |
| **I12** | Cross-cut | Every layer respects **W1–W4** (no tenant bleed, no clock lie, no surface cheat, no economy fork) | Table below |
| **I13** | Triple assurance | **R1–R3** closed: spec ↔ single enqueue surface ↔ gates/SQL/tests | **Triple assurance** section |

**Illegal transitions:** Queue lifecycle is DB-owned (`append_script_*`, `append_worker_*` RPCs); app code must not ad-hoc update `offline_conversion_queue` for terminal states. See chaos / ACK tests under `tests/chaos` and `tests/unit/oci-script-ack-failed.test.ts`.

## Determinism ladder (D1–D11)

| ID | Rule | Implementation note |
|----|------|----------------------|
| **D1** | Identity path pure | `computeOfflineConversionExternalId` — no random/time in tuple hash ([`external-id.ts`](../../lib/oci/external-id.ts)) |
| **D2** | Economics SSOT | [`marketing-signal-value-ssot.ts`](../../lib/oci/marketing-signal-value-ssot.ts) |
| **D3** | Transition timestamps | ACK routes use [`getDbNowIso`](../../lib/time/db-now.ts); drift → [`oci_time_ssot_health.sql`](../../scripts/sql/oci_time_ssot_health.sql) |
| **D4** | Replay / idempotency | Partial unique on `(site_id, provider_key, source_idempotency_key)` + `23505` collapsed in [`enqueue-intent-conversion-journal-row.ts`](../../lib/oci/enqueue-intent-conversion-journal-row.ts); seal/micro routes delegate there |
| **D5** | Stable ordering | Export + worker queries use explicit `ORDER BY` + tie-break columns |
| **D6** | Stable serialization | Hash / JSON paths avoid nondeterministic key order where contract-bound |
| **D7** | Jitter boundaries | **Only** retry delay band — see **Jitter boundary** |
| **D8** | Blast isolation | Scheduler/worker failure does not rewrite `external_id` or PK semantics |
| **D9** | No silent history rewrite | Retractions modeled explicitly (junk / adjustments), not silent deletes of fired facts |
| **D10** | Causal pin | Terminal rows retain traceable `call_id` / lineage fields |
| **D11** | Evidence pin | Same repo SHA + migration head + SQL pack hashes → reproducible PASS/FAIL class; [`collect-gate-evidence.mjs`](../../scripts/release/collect-gate-evidence.mjs); fixture shape [`ci/fixtures/export-closure-gap-sample.json`](../../ci/fixtures/export-closure-gap-sample.json) |

## STOP gates (hard)

| Signal | Response |
|--------|----------|
| `test:release-gates` or required smoke FAIL | No deploy (workspace rule) |
| `oci_time_ssot_health` RED | STOP until time SSOT repaired ([`CLOSED_SYSTEM_SCORE_CONTRACT.md`](./CLOSED_SYSTEM_SCORE_CONTRACT.md) G3) |
| Identity/hash integrity RED | STOP — G4 / duplicate economics |
| `export_closure_gap_audit` RED (stale active / malformed `external_id`) | STOP — journal closure broken |
| `export_closure_stage_journal_gap` RED (heuristic) | Drill-down — `calls.status` vs journal action mismatch (may false-positive if status lags outbox) |
| `wonMissingPipeline > 0` in rollout readiness | STOP — won/sealed call is unrepresented in queue journal (`won_missing_unrepresented_count`); run site-scoped dry-run backfill first |

## L × W cross-cut matrix (informative)

Vertical **L** layers: **L1** journal identity → **L2** gates (`BLOCKED`, G1/G2) → **L3** claim/retry/worker → **L4** SQL health + gates. Horizontal **W** axes must hold at **every** layer:

|  | **W1 Tenant** | **W2 Time** | **W3 Surface** | **W4 Economy** |
|--|---------------|-------------|----------------|----------------|
| **L1** | `site_id` + scoped unique on `(site_id, provider_key, external_id)` active rows | `occurred_at` / `occurred_at_source` migrations | Same row semantics script vs API | `action` ↔ Google name via one dictionary |
| **L2** | Policy evaluates inside tenant | Chronology guards / SSOT | One script export surface (journal) | Stage bases from SSOT |
| **L3** | Claims scoped by site | Retry timestamps from DB where contract says | Worker vs script both respect BLOCKED | No alternate value path in worker |
| **L4** | Health SQL per-site | `oci_time_ssot_health` | Reconciliation + gap packs | Value integrity packs separate |

## Triple assurance (R1–R3)

| ID | Gate | Artifact |
|----|------|----------|
| **R1** | Spec frozen | This document + invariant tables |
| **R2** | Code traceability | Non-won → `enqueueOciConversionRow`; won → `enqueueSealConversion`; export claims exclude `BLOCKED_*` for upload |
| **R3** | Evidence | `npm run test:release-gates`; health SQL packs; [`tests/unit/export-closure-determinism-contract.test.ts`](../../tests/unit/export-closure-determinism-contract.test.ts); chaos export SSOT / ACK suites |

**Single enqueue audit:** Micro stages must not bypass [`enqueueOciConversionRow`](../../lib/oci/enqueue-oci-conversion-row.ts); seal/won must go through [`enqueueSealConversion`](../../lib/oci/enqueue-seal-conversion.ts) (except documented RPC-only recovery paths).

**PR-7G represented-failed split:** `OpsMantik_Won` rows in terminal failed statuses are represented pipeline rows, not missing coverage. They remain actionable through queue failure taxonomy/provider remediation and should not be repeatedly re-enqueued as orphan pipeline repair.

## DB enforcement (journal)

- **`external_id` NOT NULL** — baseline schema [`20260502120000_ensure_oci_queue_and_signals.sql`](../../supabase/migrations/20260502120000_ensure_oci_queue_and_signals.sql).
- **Active uniqueness** — partial unique index `idx_offline_conversion_queue_site_provider_external_id_active` on `(site_id, provider_key, external_id)` for non-terminal statuses (collision = operational signal).
- **Shape CHECK (NOT VALID)** — [`20260507121500_oci_queue_external_id_shape_guard.sql`](../../supabase/migrations/20260507121500_oci_queue_external_id_shape_guard.sql): `^oci_[0-9a-f]{32}$`; validate after legacy scrub if needed.

## Clock audit (D3): DB vs wall-clock

| Concern | Authority | Notes |
|---------|-----------|--------|
| ACK / seal transition “now” | **DB** via `getDbNowIso` | [`app/api/oci/ack/route.ts`](../../app/api/oci/ack/route.ts), [`ack-failed/route.ts`](../../app/api/oci/ack-failed/route.ts) |
| OCI conversion batch kernel “now” | **DB** | [`process-conversion-batch-kernel.ts`](../../lib/oci/runner/process-conversion-batch-kernel.ts) |
| Retry jitter / probe scheduling | **Wall** allowed | Bounded entropy only — must not feed identity or Google conversion payload |
| Metrics / watchdog duration | `Date.now()` for latency | Observability only — not contract time for conversions |

Full drift audit: [`scripts/sql/oci_time_ssot_health.sql`](../../scripts/sql/oci_time_ssot_health.sql).

## Jitter boundary (D7)

- **Allowed:** `nextRetryDelaySecondsWithJitter`, env `OCI_RETRY_JITTER_MAX_SECONDS`, [`tests/unit/retry-jitter.test.ts`](../../tests/unit/retry-jitter.test.ts).
- **Forbidden:** importing identity helpers into jitter/backoff modules; using jitter to pick export ordering keys or `external_id`.

Implementation: [`lib/cron/process-offline-conversions.ts`](../../lib/cron/process-offline-conversions.ts) computes delay only — no `computeOfflineConversionExternalId`.

## DB / time SSOT

- Seal and micro rows stamp `occurred_at` / `occurred_at_source` per [`20261226013000_oci_queue_occurred_at_source_allow_intent.sql`](../../supabase/migrations/20261226013000_oci_queue_occurred_at_source_allow_intent.sql).
- **DB clock audit:** Prefer RPC timestamps for transitions; wall-clock only where explicitly documented (scheduler entropy for retry delay).
- **Journal identity:** `offline_conversion_queue.external_id` shape guard — [`20260507121500_oci_queue_external_id_shape_guard.sql`](../../supabase/migrations/20260507121500_oci_queue_external_id_shape_guard.sql) (`NOT VALID` — validate after legacy scrub if needed).

## Reconciliation / gap audit

- **Gap / staleness / shape:** [`scripts/sql/export_closure_gap_audit.sql`](../../scripts/sql/export_closure_gap_audit.sql).
- **Stage ↔ journal (best-effort, 30d lookback):** [`scripts/sql/export_closure_stage_journal_gap.sql`](../../scripts/sql/export_closure_stage_journal_gap.sql) — G1 lead with `calls.status` in the four-tuple vs matching `offline_conversion_queue.action` (false positives possible when status lags outbox).
- Operational queue health: [`scripts/sql/queue_health.sql`](../../scripts/sql/queue_health.sql).
- Queue-only compatibility rule: export-closure health packs must not depend on `public.marketing_signals` existence and must never crash when legacy audit residue tables are absent.
- Orphan won repair rule: discovery is read-only first (`scripts/sql/orphan_won_backfill.sql`), repair is site-scoped only and must flow through canonical enqueue (`enqueueSealConversion`), not ad-hoc SQL inserts/updates.
- Sweep lock rule: `sweep-unsent-conversions` lock scope is global by default, but `site_id` requests use `sweep-unsent-conversions:site:<site_id>` so site-scoped manual repairs do not wait on unrelated global sweep overlaps.
- Schema-compat rule: `calls.currency` is optional metadata for sweep repair. Canonical orphan-won repair must remain operational when that column is absent; value/currency policy remains owned by enqueue SSOT, not by sweep query schema assumptions.

## L4 evidence pin (D11)

Release flows hash SQL packs via [`evidence-contracts.mjs`](../../scripts/release/evidence-contracts.mjs). CI runs `verify-health-pack-contracts.mjs`. [`collect-gate-evidence.mjs`](../../scripts/release/collect-gate-evidence.mjs) records **`git_commit`**, **`migration_head`** (latest `supabase/migrations/*.sql` basename), and per-pack SHA256. Example column shapes for offline review: [`ci/fixtures/export-closure-gap-sample.json`](../../ci/fixtures/export-closure-gap-sample.json).

## Environment flags

| Variable | Meaning |
|----------|---------|
| `OCI_EXPORT_STRICT` | Strict operational mode (plan / runbooks). |
| `OCI_EXPORT_PAUSED` | When true, export route returns 503 (global kill switch). |
| `OCI_RETRY_JITTER_MAX_SECONDS` | Jitter band for retries (D7). |
