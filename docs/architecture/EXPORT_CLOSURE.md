# Export closure — formal design (implementation index)

This document is the **R1 (öz)** contract for the kapalı export journal: **one** upload truth surface — [`offline_conversion_queue`](../../supabase/migrations/20260502120000_ensure_oci_queue_and_signals.sql) — plus four canonical conversion names in [`lib/oci/conversion-names.ts`](../../lib/oci/conversion-names.ts). The Google Ads **script/API export route does not read `marketing_signals`**. **R2** = code links; **R3** = tests + SQL + `npm run test:release-gates` + [`scripts/release/evidence-contracts.mjs`](../../scripts/release/evidence-contracts.mjs) health packs.

## Single export surface (journal SSOT)

| Path | Role |
|------|------|
| Script batch | [`GET .../google-ads-export`](../../app/api/oci/google-ads-export/route.ts) → [`fetchExportData`](../../app/api/oci/google-ads-export/export-fetch.ts) (**queue only**) → `buildExportItems` → highest-gear dedupe within journal |
| API worker lane | Same journal rows uploaded by worker/kernel; fast-track via QStash when `oci_sync_method=api` |

**Legacy `marketing_signals`:** may still exist for hash/audit/recovery tooling; it is **not** combined into the Google export batch. Stranded PENDING rows are an operational cleanup topic (pulse/recovery), not a second upload authority.
Parity hardening rule: for Google-eligible `marketing_signals` writes, a matching `offline_conversion_queue` row is required (`marketing_signals_queue_parity_gap_count` must remain `0` in health/evidence). DB trigger lane now records violations into `parity_audit_log` / `parity_violation_dlq`; enforcement mode is controlled by `app.settings.oci_marketing_signal_queue_parity_enforcement` (`observe` default, `enforce` optional).

## Four conversion matrix (lifecycle → journal)

| Stage | `action` / Google name | Emit path | Notes |
|-------|------------------------|-----------|--------|
| junk | `OpsMantik_Junk_Exclusion` | IntentSealed `outbox_events` → [`runProcessOutbox`](../../lib/oci/outbox/process-outbox.ts) → [`enqueueOciConversionRow`](../../lib/oci/enqueue-oci-conversion-row.ts) | Junk reversal may enqueue [`conversion_adjustments`](../../lib/oci/outbox/process-outbox.ts) retractions |
| contacted | `OpsMantik_Contacted` | same | Single-conversion gear rank suppresses lower stages when higher exists |
| offered | `OpsMantik_Offered` | same | |
| won | `OpsMantik_Won` | Outbox won branch → [`enqueueSealConversion`](../../lib/oci/enqueue-seal-conversion.ts); seal / sweep paths also | Precursor gate: [`hasBlockingPrecedingExports`](../../lib/oci/preceding-signals.ts) |

**Intent-only Ads conversion:** no separate “raw intent” conversion action in the closed-system path; optional panel precursor is gated by `OCI_INTENT_PANEL_PRECURSOR_CONTACTED_ENABLED` (see [`enqueue-panel-stage-outbox.ts`](../../lib/oci/enqueue-panel-stage-outbox.ts)).

## Queue-only upload path audit matrix

| Conversion | Current producer | Current table | Current upload path | Should be queue? | Double-path risk | Class | Action |
|---|---|---|---|---|---|---|---|
| contacted | `runProcessOutbox` / stage-router fire | `offline_conversion_queue` (plus legacy `marketing_signals` audit writes) | `google-ads-export` reads queue only | yes | legacy audit write can confuse ops if treated as upload | `QUEUE_CANONICAL` + `AUDIT_ONLY` | keep queue as authority; treat `marketing_signals` as non-upload lane |
| offered | `runProcessOutbox` / stage-router fire | `offline_conversion_queue` (plus legacy `marketing_signals`) | queue-only fetch | yes | same as contacted | `QUEUE_CANONICAL` + `AUDIT_ONLY` | same |
| won | seal/outbox/sweep enqueue | `offline_conversion_queue` | queue-only fetch | yes | low (won already queue authority) | `QUEUE_CANONICAL` | keep helper-only writes |
| junk exclusion | `runProcessOutbox` micro-stage path (with optional retraction adj records) | `offline_conversion_queue` | queue-only fetch | yes | medium if old signal-only assumptions linger | `QUEUE_CANONICAL` | keep queue authority; preserve explicit blocked/skip semantics |

`marketing_signals` classification in this contract: **`AUDIT_ONLY`** (legacy/hash/recovery/evidence), **not** an independent Google upload source.

## Formal invariant index (I1–I13)

| ID | Scope | Rule (summary) | Pointer |
|----|-------|----------------|---------|
| **I1–I8** | Score / tenant / value | Closed-system gates G1–G5; tenant scope; economics SSOT | [`CLOSED_SYSTEM_SCORE_CONTRACT.md`](./CLOSED_SYSTEM_SCORE_CONTRACT.md), [`queue-health-contract.ts`](../../lib/oci/queue-health-contract.ts) |
| **I9** | Four-fire → journal | Canonical stage emit → `offline_conversion_queue` row or explicit `BLOCKED_*` audit — **no silent skip** when stage is considered fired | [`enqueue-oci-conversion-row.ts`](../../lib/oci/enqueue-oci-conversion-row.ts), [`enqueue-seal-conversion.ts`](../../lib/oci/enqueue-seal-conversion.ts) |
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
| **D4** | Replay / idempotency | Unique-active index + `23505` treated as success path in [`enqueue-oci-conversion-row.ts`](../../lib/oci/enqueue-oci-conversion-row.ts), [`enqueue-seal-conversion.ts`](../../lib/oci/enqueue-seal-conversion.ts) |
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

## L4 evidence pin (D11)

Release flows hash SQL packs via [`evidence-contracts.mjs`](../../scripts/release/evidence-contracts.mjs). CI runs `verify-health-pack-contracts.mjs`. [`collect-gate-evidence.mjs`](../../scripts/release/collect-gate-evidence.mjs) records **`git_commit`**, **`migration_head`** (latest `supabase/migrations/*.sql` basename), and per-pack SHA256. Example column shapes for offline review: [`ci/fixtures/export-closure-gap-sample.json`](../../ci/fixtures/export-closure-gap-sample.json).

## Environment flags

| Variable | Meaning |
|----------|---------|
| `OCI_EXPORT_STRICT` | Strict operational mode (plan / runbooks). |
| `OCI_EXPORT_PAUSED` | When true, export route returns 503 (global kill switch). |
| `OCI_RETRY_JITTER_MAX_SECONDS` | Jitter band for retries (D7). |
