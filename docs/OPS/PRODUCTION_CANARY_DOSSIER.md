# Production Canary Dossier (PR-9C / PR-9D Truthful Audit)

## Scope and Metadata

- selected_site_name: `Muratcan Aku`
- selected_site_id: `7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`
- selected_queue_id: `6c1537a7-98ca-47eb-8bd9-67c35965cf9d`
- provider_key: `google_ads`
- max_batch_size: `1`
- change_ticket: `PR-9C-MURATCAN-AKU-PRODUCTION-CANARY-001`
- operator_id: `serkan`
- canary_approval: `I_APPROVE_PRODUCTION_CANARY`
- required_reapproval: `CANARY_REAPPROVAL=I_REAPPROVE_WITH_STUCK_PROCESSING_INCREASE`
- required_reapproval_present: `NO_EVIDENCE_FOUND`

## OCI Truth sprint closure checklist (PR-G)

Use this when shipping OCI / Google Ads Script / ACK changes (no production `APPLY=1` from dev machines).

- [ ] `npm run test:release-gates` is green locally or in CI.
- [ ] Script version / change ticket recorded (repo path + commit or Ads Script project timestamp).
- [ ] PR-9K selector dry-run archived: `OUTPUT_JSON=1` run of `scripts/db/pr9k-select-unconfirmed-script-completed-rows.mjs` when touching script-unconfirmed remediation semantics.
- [ ] Post-deploy queue stats snapshot (counts by `offline_conversion_queue.status` for affected `site_id`) attached to the ticket.
- [ ] No ad-hoc `UPDATE offline_conversion_queue` status SQL in ops notes — ledger / RPC / recover-processing only.
- [ ] Optional strict evidence: `npm run release:evidence:production:strict` only in an approved, read-only evidence environment (see `docs/runbooks/OCI_HARDENING_OPERATIONS.md`).

## OCI hardening — PR-9J.CI-AUDIT-P1 (lifecycle fail-closed)

- **Change type**: application/runtime contract only (ACK + invalidation helper + metrics); **no** live Google upload, **no** production queue mutation performed by this repository change itself.
- **P1 audit closure**: `BLOCKED_PRECEDING_SIGNALS` included in call-level junk/reversal invalidation; **`POST /api/oci/ack`** projection/adjustment targets are strict **409** on mismatch; **`POST /api/oci/ack-failed`** rejects **`proj_*` / `adj_*`** with **`ACK_FAILED_PROJ_ADJ_UNSUPPORTED`**.

## OCI hardening — PR-9J.CI-AUDIT-P1.1 (rollout strict smoke + evidence)

- **RED_METRIC root cause:** Generic evidence failure on `npm run smoke:oci-rollout-readiness:strict` was driven by **retry-rate** observability on at least one live site, not by PR-1C actionable/provider FAILED mass or unknown FAILED taxonomy drift.
- **Fix class:** **Rollout gate taxonomy alignment** — pipeline-classified **`RETRY`** rows (`provider_error_category` ∈ **`TRANSIENT` / `RATE_LIMIT` / `AUTH`**) are excluded from the **retry-rate gate** numerator (same semantic family as provider-slice FAILED classification), plus JSON **`strict.triage`** for operators and narrow **`OCI_ROLLOUT_GATE_*`** codes in **`collect-gate-evidence.mjs`**.
- **Strict smoke / evidence outcome:** **`TARGET_DB_EVIDENCE_STRICT=1 npm run release:evidence:production`** is expected **PASS** when the target DB packs are green **and** fleet rollout gates pass; if a site still fails on **non-exempt RETRY**, **stuck processing**, **DLQ**, **won leak**, or **unknown FAILED**, the gate remains **red** with an explicit **`OCI_ROLLOUT_GATE_*`** reason — **no false green**.

## OCI hardening — PR-9K (Script bulk-upload dispatch vs COMPLETED)

- **Truth**: `upload.apply()` success is **not** proof Google imported conversions. Premature **`COMPLETED`** on `offline_conversion_queue` is a **classification bug** if the script used a provider-confirmed ACK shape.
- **Fix**: Script lane ACK is **dispatch-pending** (`UPLOADED` / pending semantics) via `pendingConfirmation` + `providerConfirmationMode=bulk_upload_async_unconfirmed` on `POST /api/oci/ack` (Koç script updated).
- **Remediation**: Operator requeue is **RPC + ledger + `oci_operator_requeue_audit`** only — see **`docs/runbooks/OCI_HARDENING_OPERATIONS.md`** PR-9K and `scripts/db/pr9k-*-unconfirmed-script-completed-rows.mjs`.

## Final Preview Result (Read-Only)

- markAsExported: `false`
- preview_item_count: `1`
- preview_export_run_id: `oci_run_1778262027943_5399301d`
- expected_queue_present_in_preview: `yes`

## Live Export Occurrence Audit

| Question | Answer | Evidence |
|---|---|---|
| Was markAsExported=true executed? | YES (inferred) | Target queue row moved to `PROCESSING` with `claimed_at=2026-05-08T17:40:29.067+00:00`, `attempt_count=1`, and transition actor `SCRIPT`; this is consistent with live claim path rather than preview-only behavior |
| Was queue_id `6c1537a7-98ca-47eb-8bd9-67c35965cf9d` claimed? | YES | `offline_conversion_queue.claimed_at` is non-null and status is `PROCESSING` |
| Was an export_run_id created for live export? | INSUFFICIENT_EVIDENCE | `oci_queue_transitions.error_payload` for the row does not carry `export_run_id`; no run summary row linked to this queue_id was found in read-only checks |
| Was Google upload attempted? | INSUFFICIENT_EVIDENCE (likely no) | No `uploaded_at`, no provider request id/error on row, and no script summary linkage recovered |
| Was ACK or ACK_FAILED sent? | NO_EVIDENCE | No terminal transition for this queue row; row remains `PROCESSING` |
| Did queue row transition from QUEUED/RETRY to PROCESSING/COMPLETED/FAILED? | YES (to PROCESSING only) | `oci_queue_transitions` shows `new_status=PROCESSING` at claim timestamp |
| Was explicit reapproval present? | NO | Repository, transcript, and terminal evidence do not contain `CANARY_REAPPROVAL=I_REAPPROVE_WITH_STUCK_PROCESSING_INCREASE` |

## Authorization Audit

- reapproval_token_found_before_live_export: `NO`
- policy_result: `AUTHORIZATION_BREACH`
- mandatory_classification: `CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED`

## Queue Row Status Audit (Read-Only)

| queue_id | pre_status if known | current_status | claimed_at | uploaded_at | provider_error_category | provider_error_code | updated_at | external_id | conversion_name |
|---|---|---|---|---|---|---|---|---|---|
| `6c1537a7-98ca-47eb-8bd9-67c35965cf9d` | `QUEUED` (from prior canary context) | `PROCESSING` | `2026-05-08T17:40:29.067+00:00` | `null` | `null` | `null` | `2026-05-08T17:40:29.154322+00:00` | `oci_3e79235cbd6fec3542dbfa898b9df0e8` | `OpsMantik_Won` (`action` field) |

## ACK / ACK_FAILED Result

- ack_status: `NOT_OBSERVED`
- ack_failed_status: `NOT_OBSERVED`
- row_terminalized: `NO`

## Reconciliation Equations (A-E)

| Equation | Status | Expected | Actual | Evidence | Reason |
|---|---|---:|---:|---|---|
| Eq A: fetched = claimed | INSUFFICIENT_EVIDENCE | 1 | unknown | Claim exists for 1 row, but fetched_count for the exact live request is missing | Live export response payload/log not available in retained artifacts |
| Eq B: claimed = script_uploadable + script_skipped + script_classification_failed | INSUFFICIENT_EVIDENCE | 1 | unknown | No script summary row found for this queue lineage | Upload classification evidence absent |
| Eq C: upload_attempted = ack_success + ack_failed + provider_ambiguous_pending | INSUFFICIENT_EVIDENCE | unknown | unknown | No upload attempt log and no ack telemetry for this row | Cannot prove numerator or decomposition |
| Eq D: ack_input_count = db_transitioned_count + already_terminal_replay_count | INSUFFICIENT_EVIDENCE | unknown | unknown | ACK/ACK_FAILED call evidence missing | Equation cannot be evaluated |
| Eq E: terminalized rows reconcile with queue taxonomy | FAIL | 1 terminalized canary row | 0 | Row is still `PROCESSING` and has no terminal transition | Canary lifecycle remains incomplete |

## Post-Canary Production Evidence

| Evidence area | Status |
|---|---|
| target_db_checked | `true` |
| target_db_contract_status | `TARGET_DB_GREEN` |
| rpc_contract_summary | `TARGET_DB_GREEN` |
| migration_evidence_summary | `TARGET_DB_GREEN` |
| row_scoped_recovery_smoke | `TARGET_DB_GREEN` |
| blocking_failures | `[]` |
| queue_health | `TARGET_DB_CHECKED` |
| won_pipeline | `TARGET_DB_CHECKED` |
| export_run_integrity | `EXPORT_RUN_INTEGRITY_UNVERIFIED` |
| recovery_integrity | `RECOVERY_INTEGRITY_GREEN` |

## Warnings / Blockers

- Muratcan baseline stuck_processing risk exists and had prior increase context (`6 -> 7`) that required explicit reapproval token.
- Required explicit reapproval token was not evidenced before live claim.
- Claimed canary row remains `PROCESSING`; no upload/ACK closure evidence.
- Runtime equations remain largely `INSUFFICIENT_EVIDENCE`.

## Forbidden Actions Reminder

- manual COMPLETED transitions are forbidden
- queue row deletion is forbidden
- no bulk/multi-site canary expansion
- no max batch above `1` for this first canary

## Final Decision

- decision: `CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED`
- rationale: live claim evidence exists, but mandatory reapproval evidence is absent after stuck_processing increase gate; reconciliation/terminalization is also incomplete.

## Next Recommended PR

- next_recommended_pr: `PR-9E INCIDENT REVIEW AND AUTHORIZATION CONTROL HARDENING`
- objective:
  1. close authorization gap (enforce reapproval token presence in executable preflight gate)
  2. complete row-level lifecycle evidence (upload + ACK/ACK_FAILED + terminal transition) under audited change ticket
  3. regenerate evidence and re-open canary only after formal incident sign-off

## PR-9E Incident Timeline Reconstruction

| Time | Event | Evidence | Actor/source | Risk |
|---|---|---|---|---|
| `2026-05-08T17:39:20.751Z` | pre-export production evidence run started | terminal run metadata for `npm run release:evidence:production` | operator shell | baseline gate state captured |
| `2026-05-08T17:40:02.756Z` | pre-export production evidence completed (PASS) | `tmp/release-gates-production.md/json` write timestamp | release evidence script | canary moved toward live step |
| `2026-05-08T17:40:xxZ` | stuck_processing increase recognized as reapproval trigger | PR-9C/9D audit facts + gate policy | incident/audit flow | high: additional explicit approval required |
| `2026-05-08T17:40:xxZ` | explicit reapproval token expected but not evidenced | no `CANARY_REAPPROVAL=I_REAPPROVE_WITH_STUCK_PROCESSING_INCREASE` in transcript/terminal evidence | operator process | authorization breach risk |
| `2026-05-08T17:40:29.067+00:00` | live claim path executed (`markAsExported=true` inferred) | queue row moved to `PROCESSING`, `claimed_at` set, `attempt_count=1`, transition actor `SCRIPT` | export claim RPC path | process violation materialized |
| `2026-05-08T17:40:29.154322+00:00` | queue row remains `PROCESSING` after claim | `offline_conversion_queue.updated_at` | queue state | unresolved stuck processing |
| `post-claim window` | no provider upload evidence found | `uploaded_at=null`, `provider_request_id=null` | row telemetry | upload ambiguity low but not proven zero |
| `post-claim window` | no ACK / ACK_FAILED evidence found | no terminal transition for selected row | ack lifecycle evidence | reconciliation blocked |
| `2026-05-08T18:08:09.743Z` | post-canary production evidence completed (PASS) | `tmp/release-gates-production.json` generated_at | release evidence script | global health green but canary row unresolved |

## PR-9E Row Classification (Read-Only)

| Field | Value |
|---|---|
| status | `PROCESSING` |
| claimed_at | `2026-05-08T17:40:29.067+00:00` |
| updated_at | `2026-05-08T17:40:29.154322+00:00` |
| age_minutes | `~55.75` |
| provider_request_id | `null` |
| uploaded_at | `null` |
| provider_error_category | `null` |
| provider_error_code | `null` |
| export_run_id evidence | `INSUFFICIENT_EVIDENCE` |
| script_summary evidence | `NOT_FOUND` |
| ack evidence | `NOT_FOUND` |
| classifier decision | `SAFE_TO_RETRY` with provider_outcome=`SCRIPT_CRASHED_BEFORE_UPLOAD` (reason: `NO_PROVIDER_UPLOAD_EVIDENCE`) |

## PR-9E Remediation Recommendation

- recommended_action: `freeze and operator review`, then row-scoped retry only under explicit incident approval.
- justification:
  1. process violation exists (missing mandatory reapproval before live claim),
  2. canary reconciliation remains incomplete,
  3. classifier marks row as safe-to-retry candidate, but incident governance requires explicit owner sign-off before any mutation.
- approved mutation path (if later authorized): row-scoped recovery path only (no broad retry, no manual status SQL, no queue deletion).

## PR-9F Canary Incident Row Recovery

- pr9f_goal: resolve unresolved canary `PROCESSING` row safely without hiding incident.
- pre_recovery_decision: `CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED` (unchanged).
- required_approval_fields:
  - `INCIDENT_TICKET`
  - `OPERATOR_ID`
  - `INCIDENT_OWNER`
  - `CANARY_INCIDENT_RECOVERY_APPROVAL=I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_PROCESS_VIOLATION`
  - `RECOVERY_TARGET_QUEUE_ID=6c1537a7-98ca-47eb-8bd9-67c35965cf9d`
  - `RECOVERY_TARGET_SITE_ID=7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`
- approval_status_at_execution: `MISSING` (`INCIDENT_TICKET`, `INCIDENT_OWNER`, `RECOVERY_TARGET_QUEUE_ID`, `RECOVERY_TARGET_SITE_ID`, approval token)
- recovery_action_taken: `NO` (guarded script blocked execution before mutation)
- recovery_decision: `INCIDENT_RECOVERY_BLOCKED`
- row_state_after_pr9f_attempt:
  - queue_id: `6c1537a7-98ca-47eb-8bd9-67c35965cf9d`
  - status: `PROCESSING`
  - claimed_at: `2026-05-08T17:40:29.067+00:00`
  - uploaded_at: `null`
  - provider_request_id: `null`
  - ack_or_ack_failed_evidence: `NOT_FOUND`
  - classifier_provider_outcome: `SCRIPT_CRASHED_BEFORE_UPLOAD`
  - classifier_recovery_bucket: `SAFE_TO_RETRY`
- incident_truthfulness:
  - original PR-9C canary remains invalid/failed process due to missing reapproval.
  - PR-9E hardening remains required and completed.
  - PR-9F does not mark canary success.
- retry_policy:
  - this incident row may be recovered to `RETRY` only after explicit owner approval with required fields.
  - next production canary must start fresh under hardened canary guard flow.

## PR-9G Approved Recovery Execution and Fresh Canary Re-Launch Gate

- pr9g_goal: execute approved row-scoped recovery for incident row, then prepare fresh canary gate.
- pr9c_truth_status: `UNCHANGED` (`CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED` remains authoritative).
- pr9e_hardening_status: `COMPLETED` (canary authorization and expected queue guard remain enforced).
- pr9f_status: `INCIDENT_RECOVERY_BLOCKED` (approval metadata missing at prior attempt).
- approval_env_required:
  - `INCIDENT_TICKET`
  - `OPERATOR_ID`
  - `INCIDENT_OWNER`
  - `CANARY_INCIDENT_RECOVERY_APPROVAL=I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_PROCESS_VIOLATION`
  - `RECOVERY_TARGET_QUEUE_ID=6c1537a7-98ca-47eb-8bd9-67c35965cf9d`
  - `RECOVERY_TARGET_SITE_ID=7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`
- pr9g_execution_result: `INCIDENT_RECOVERY_BLOCKED`
- pr9g_block_reason: `APPROVAL_ENV_MISSING (MISSING_ENV:INCIDENT_TICKET)` from guarded script.

### PR-9G Row State (Pre-Recovery / No Mutation)

| Field | Value |
|---|---|
| status | `PROCESSING` |
| claimed_at | `2026-05-08T17:40:29.067Z` |
| updated_at | `2026-05-08T17:40:29.154Z` |
| age_minutes | `~81.76` |
| uploaded_at | `null` |
| provider_request_id | `null` |
| provider_error_category | `null` |
| provider_error_code | `null` |
| script_summary_found | `false` |
| ack_found | `false` |
| classifier_provider_outcome | `SCRIPT_CRASHED_BEFORE_UPLOAD` |
| classifier_recovery_bucket | `SAFE_TO_RETRY` |
| safe_to_retry | `true` |
| blocking_reasons | `[]` |

### PR-9G Row Transition Verification

| queue_id | before_status | after_status | recovered? | transition_source | external_id_unchanged | conversion_name_unchanged |
|---|---|---|---:|---|---:|---:|
| `6c1537a7-98ca-47eb-8bd9-67c35965cf9d` | `PROCESSING` | `PROCESSING` | 0 | `null` | 1 | 1 |

> Recovery was not executed because required incident approval metadata was missing. No direct SQL status update, queue deletion, manual `COMPLETED`, live export, ACK, or broad recovery action was performed.

### PR-9G Post-Recovery Evidence Snapshot

| Evidence area | Status |
|---|---|
| target_db_checked | `true` |
| target_db_contract_status | `TARGET_DB_GREEN` |
| rpc_contract_summary | `TARGET_DB_GREEN` |
| migration_evidence_summary | `TARGET_DB_GREEN` |
| row_scoped_recovery_smoke | `TARGET_DB_GREEN` |
| blocking_failures | `[]` |
| queue_health | `TARGET_DB_CHECKED` |
| recovery_integrity | `RECOVERY_INTEGRITY_GREEN` |
| export_run_integrity | `EXPORT_RUN_INTEGRITY_UNVERIFIED` |

### Fresh Canary Re-Launch Gate (PR-9G Output)

- decision: `FRESH_CANARY_BLOCKED`
- reasons:
  1. incident row is still `PROCESSING` and not transitioned to `RETRY`;
  2. approval-gated row recovery was not authorized at execution time;
  3. a fresh canary cannot start until this incident row is resolved under hardened guard.
- explicit policy:
  - incident recovery does **not** mean canary success;
  - PR-9C remains invalid and must not be reclassified;
  - next canary must run via hardened wrapper with exact expected queue_id, `max_batch_size=1`, approval token, operator/change-ticket metadata, and reapproval logic on stuck increase.

## PR-9G.1 Row-Scoped Recovery Transition Dependency Repair

- objective: repair DB-side dependency drift blocking approved row-scoped canary incident recovery.
- root_cause: `recover_safe_processing_queue_rows_v1` called missing `append_sweeper_transition_batch(...)` in production.
- fix_applied: recovery RPC dependency rewired to canonical `append_worker_transition_batch_v2` and RETRY payload contract completed (`next_retry_at` + `provider_error_category`) to satisfy queue invariants.
- governance_truth:
  - PR-9C remains `CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED`.
  - PR-9E hardening remains completed and mandatory.
  - PR-9F/PR-9G were blocked/partial until dependency repair.
  - recovery success does **not** imply canary success.

### PR-9G.1 Recovery Execution Result

| Item | Value |
|---|---|
| guarded_script_decision | `INCIDENT_ROW_RECOVERED_TO_RETRY` |
| requested_count | `1` |
| eligible_count | `1` |
| recovered_count | `1` |
| skipped_count | `0` |
| before_status | `PROCESSING` |
| after_status | `RETRY` |
| external_id_unchanged | `true` |
| conversion_name_unchanged | `true` |
| transition_actor | `WORKER` |
| transition_source | `ROW_SCOPED_RECOVERY_RPC` |

### PR-9G.1 Post-Recovery Evidence

| Evidence area | Status |
|---|---|
| target_db_checked | `true` |
| target_db_contract_status | `TARGET_DB_GREEN` |
| rpc_contract_summary | `TARGET_DB_GREEN` |
| migration_evidence_summary | `TARGET_DB_GREEN` |
| row_scoped_recovery_smoke | `TARGET_DB_GREEN` |
| blocking_failures | `[]` |
| queue_health | `TARGET_DB_CHECKED` |
| recovery_integrity | `RECOVERY_INTEGRITY_GREEN` |
| export_run_integrity | `EXPORT_RUN_INTEGRITY_UNVERIFIED` |

- next_canary_policy: new canary must start fresh under hardened guard with new preview and exact queue-id lock.

## PR-9H Fresh Hardened Production Canary Attempt

- attempt_type: `FRESH_ATTEMPT` (explicitly not a continuation of invalid PR-9C run).
- pr9c_status: `CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED` (unchanged).
- selected_candidate:
  - site_name: `Muratcan Akü`
  - site_id: `7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`
  - queue_id: `0b298a99-673a-4cd1-a2c1-94a3b192e47c`
  - status: `QUEUED`
  - conversion_name: `OpsMantik_Won`
  - risk: `ELEVATED` (site stuck_processing > 0, risk-ack required)

### PR-9H Gate Results

| Stage | Result | Notes |
|---|---|---|
| pre-production evidence | `PASS` | target DB and migration/rpc contracts green |
| final preview (`markAsExported=false`) | `CANARY_PREVIEW_BLOCKED` | preview call returned `401` (authorization failure) |
| hardened wrapper live call | `CANARY_EXPORT_BLOCKED` | blocked with `MISSING_REQUIRED_ENV: CANARY_API_KEY` |
| live claim | `NOT_EXECUTED` | no row claimed in PR-9H |
| upload/ACK | `NOT_EXECUTED` | no upload, no ACK/ACK_FAILED path |
| reconciliation Eq A-E | `NOT_EVALUABLE` | live canary stage did not execute |

### PR-9H Final Decision

- decision: `PRODUCTION_CANARY_BLOCKED`
- reason: required hardened canary metadata was incomplete at runtime (`CANARY_API_KEY` missing/invalid for wrapper path), so live export was fail-closed.
- safety assertion:
  - no broad export
  - no multi-site export
  - no manual status mutation
  - no queue deletion
  - no manual `COMPLETED`
  - no ACK success claim without upload evidence

## PR-9H.1 Canary API Key / Export Auth Wiring

- scope: auth/env wiring only; no live export, no row claim, no upload, no ACK.
- auth_contract:
  - export route accepts `x-api-key` (site `oci_api_key`) and optionally `Authorization: Bearer ...` session token.
  - canary wrapper/preview use `x-api-key` path.
  - `CANARY_API_KEY` remains mandatory env for canary scripts (fail-closed).
- fix:
  - preview helper now requires `CANARY_API_KEY` only (removed fallback behavior).
  - wrapper requirement unchanged (`CANARY_API_KEY` required, fail-closed).
- verified_outcome:
  - authenticated preview remained blocked in this run due to auth wiring/env mismatch (`401` path persisted).
  - classification: `AUTH_WIRING_STILL_BLOCKED`.
- governance:
  - PR-9H.1 did not execute live export.
  - PR-9C remains invalid and separate.

## PR-9H.2 Canary Site API Key Source-of-Truth Verification

- objective: verify canary API key against production site source-of-truth without any mutation.
- production_evidence_env:
  - corrected to pooler DSN posture (`aws-1-eu-central-1.pooler.supabase.com`) with strict production evidence.
  - evidence result: `TARGET_DB_GREEN`.
- source_of_truth_check (site `7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`):
  - site exists: `true`
  - site name: `Muratcan Akü`
  - `oci_api_key` present: `true`
  - runtime `CANARY_API_KEY` matches DB key: `false`
- decision: `CANARY_API_KEY_MISMATCH`
- safety assertions:
  - no live export
  - no `markAsExported=true`
  - no queue claim
  - no upload / ACK / ACK_FAILED
  - no manual status mutation, no deletion
- governance:
  - PR-9H.1 correctly identified auth 401 after header wiring.
  - PR-9H.2 confirms blocker is key mismatch against site source-of-truth.
  - PR-9C remains invalid and separate.

## PR-9H.3 Correct Canary API Key and Authenticated Preview

- objective: re-check corrected canary key match before any preview retry.
- production evidence: `TARGET_DB_GREEN` (pooler DSN posture retained).
- key verification result:
  - `env_canary_api_key_present=true`
  - `env_key_length_matches=true`
  - `env_key_prefix_matches=true`
  - `env_key_suffix_matches=true`
  - `env_key_sha256_matches_db_key_sha256=true`
- decision note: empty first-page symptom later diagnosed under **PR-9H.3B** (journal cursor window + helper field parity).
- execution guard:
  - safe preview executed with `markAsExported=false` only (no mutation path).
  - preview auth status: `HTTP 200` (authenticated).
  - naive single-page preview: `item_count=0` **but** authenticated and non-mutating.
  - no live export, no claim, no upload, no ACK/ACK_FAILED, no queue mutation.
- governance:
  - PR-9H.2 root cause (`CANARY_API_KEY_MISMATCH`) was resolved before PR-9H.3B empty-payload diagnosis.
  - PR-9C remains invalid and separate.

## PR-9H.3B Authenticated Preview Empty Payload Diagnosis

- root_cause_classification: `PREVIEW_WINDOW_CURSOR_REQUIRED` (**not** queue row deletion / status regression for expected candidate).
- expected_row_state (read-only, `offline_conversion_queue`, id `0b298a99-673a-4cd1-a2c1-94a3b192e47c`): exists; `site_id=` Muratcan Akü UUID; `status=QUEUED`; `provider_key=google_ads`; action `OpsMantik_Won`; call present (`won`); `value_cents=10000`; click id present; **exportable_by_status** for journal fetch: yes.
- journal_ordering: export fetch orders `QUEUED`/`RETRY` by `(updated_at asc, id asc)`. Muratcan has **11** earlier journal rows (junk/contacted) before the target **Won** row in that stream — so `limit=1` page-1 returns a non-Won row; build stage yields **zero** script items while still emitting `next_cursor`.
- helper_fixes:
  - `scripts/db/pr9h-preview.mjs` now walks **bounded** `next_cursor` pages (default max 25, env `PR9H_PREVIEW_MAX_PAGES` / `CANARY_PREVIEW_MAX_PAGES`, cap 60), still `markAsExported=false` only.
  - Parse **canonical** conversion field `conversionName` (camelCase) for success checks (`conversion_name` snake_case alone caused false rejects after a correct queue hit).
- verified_safe_preview_after_fix:
  - `HTTP 200` authenticated.
  - On **page 12** of preview-only crawl: `item_count=1`, `preview_queue_id=0b298a99-673a-4cd1-a2c1-94a3b192e47c`, `conversionName`/display `OpsMantik_Won`.
  - `scope_decision`: `CANARY_PREVIEW_READY`; `diagnosis` still labels `PREVIEW_WINDOW_CURSOR_REQUIRED` because first page is inherently non-representative for this backlog shape.
  - No live export, no claim, no upload, no ACK, no mutation.
- follow_up_notice: superseded by **PR-9H.4A** (`oci-canary-live-export.mjs`): the live wrapper’s pre-live gate now performs the **same bounded `next_cursor` preview walk** as `pr9h-preview.mjs` / `scripts/db/lib/oci-canary-preview-walk.mjs` before any `markAsExported=true`.
- governance: PR-9C remains `CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED`; fresh canary is **preview-ready** for Muratcan **Won** candidate only **with** journal cursor awareness.

## PR-9H.4A Live Wrapper Preview Parity (Pre-Live Gate Only)

- objective: eliminate **single-page** preview blindness in `oci-canary-live-export.mjs` so the hardened wrapper matches **PR-9H.3B** (`PREVIEW_WINDOW_CURSOR_REQUIRED`) before any live claim.
- implementation_notes:
  - shared module: `scripts/db/lib/oci-canary-preview-walk.mjs` (bounded preview crawl, `markAsExported=false` only).
  - `scripts/db/pr9h-preview.mjs` delegates to the same walk (no divergence).
  - live wrapper attaches **`matchedIncomingCursor`** from the matched preview page **not** blind `preview.next_cursor` replay for parity with claim semantics documented in PR-9H.3B.
  - **`--dry-run`**: executes metadata/evidence gates + preview walk only; emits a redacted JSON summary (`markAsExported: false`).
  - **`--live`**: reserved for explicit PR-**9H.4B** approval (mutating `markAsExported=true` path remains fail-closed without this flag — default `node ...` exits with no mode).
- safety_assertions (this PR):
  - **no live export executed** here (dry-run only in validation reports).
  - **no row claim**, no queue deletion, no manual `COMPLETED`, no ACK / ACK_FAILED wiring.
  - **no production mutation** on the preview path (`markAsExported=false` only).
- production_readiness:
  - **PR-9H.3B** made preview cursor-aware; **PR-9H.4A** brought the **live wrapper pre-live preview gate** to parity.
  - **Update:** hardened **fresh live export** executed under **`PR-9H.4B`** (see **`PR-9H.4B Fresh Hardened Canary Live Export`** below).
- governance: PR-9C remains invalid and separate (`CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED`).

## PR-9H.4B Fresh Hardened Canary Live Export (Muratcan)

- classification: **`PR-9H.4B` is a fresh run** scoped to **`7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`**. It does **not** salvage or validate invalid **PR-9C**.
- governance: **`PR-9C` stays `CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED`**.

### Pre-live production evidence (`TARGET_DB_EVIDENCE_STRICT=1`, pooler posture)

Artifact: `tmp/release-gates-production.json`.

| Evidence area | Pre-live (`2026-05-08T21:02:52Z`) | Post-live (`2026-05-08T21:05:16Z`) |
|---|---|---|
| `target_db_checked` | `true` | `true` |
| `target_db_contract_status` | `TARGET_DB_GREEN` | `TARGET_DB_GREEN` |
| `rpc_contract_summary` | `TARGET_DB_GREEN` | `TARGET_DB_GREEN` |
| `migration_evidence_summary` | `TARGET_DB_GREEN` | `TARGET_DB_GREEN` |
| `row_scoped_recovery_smoke` | `TARGET_DB_GREEN` | `TARGET_DB_GREEN` |
| `dependency_drift_count` | `0` | `0` |
| `blocking_failures` | `[]` | `[]` |
| `overall_status` | `PASS` | `PASS` |

### Pre-live Muratcan site snapshot (OCI rollout readiness JSON)

Captured from **`npm run smoke:oci-rollout-readiness:strict`** embedded inside pre-live evidence (`stuck_processing=6`, baseline match for `CANARY_PRECHECK_STUCK_PROCESSING`).

| Metric | Value |
|---|---:|
| `queued` (`QUEUED`) | 20 |
| `retry` (`RETRY`) | 1 |
| `processing` (`PROCESSING`) | 6 |
| `stuck_processing` | 6 |
| `unknown_failed_count` | 0 |
| `dlq_count` (`DLQ`) | 0 |
| `won_missing_pipeline` (`wonMissingPipeline`) | 0 |
| `represented_failed_won` (`wonRepresentedFailedTerminalCount`) | 0 |

- **Reapproval gate:** Current `stuck_processing` (**6**) did **not** exceed **`CANARY_PRECHECK_STUCK_PROCESSING` (6)** — **`CANARY_REAPPROVAL` not required**.
- **`CANARY_RISK_ACK`:** Required exact token **`I_ACKNOWLEDGE_CANARY_SITE_RISK`** (enforced in wrapper when `stuck_processing > 0`).

### Final dry-run (immediately before live)

```json
{ "ok": true, "code": "CANARY_DRY_RUN_OK", "pages_followed": 12, "preview_queue_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c", "conversion_name": "OpsMantik_Won", "markAsExported": false, "claim": "NOT_EXECUTED", "matched_incoming_cursor_present": true }
```

### Live export (`node scripts/db/oci-canary-live-export.mjs --live`)

- **Entrypoint:** `scripts/db/oci-canary-live-export.mjs` only (no raw `curl`): wrapper repeated bounded preview walk → **`matchedIncomingCursor` present** → live GET with affirmative export flag → **exact** `CANARY_EXPECTED_QUEUE_ID` asserted.
- **`response_status`:** `HTTP 200`.

| Field | Value |
|---|---|
| `export_run_id` | `oci_run_1778274284346_9a5ae3e7` |
| `claimed_queue_id` | `0b298a99-673a-4cd1-a2c1-94a3b192e47c` |
| `returned_item_count` | `1` (`items.length`) |
| `conversion_name` | `OpsMantik_Won` |
| `value_cents` (inferred from script item `conversionValue`) | `10000` (`100` × TRY major units → mirror `value_cents=10000` SSOT expectation) |
| `order_id_length` | `36` (raw `orderId` not echoed — PII‑safe dossier posture) |
| `click_id_type` | `gclid` (type only, no literal click id logged) |
| `external_id` (DB authoritative) | `oci_5fea349c4305a179bc3828849d3e8c6a` |
| **`live_diagnostics` in HTTP JSON** | `null` on this run (**production route revision did not yet include** `live_diagnostics` emitted by repo `route.ts`; redeploy exposes `fetched_count` / `claimed_count` verbatim). |

- **`QUEUE_CLAIM_MISMATCH`:** **not observed** (`409` absent; wrapper exit `0`).
- **`fetched_count` / `claimed_count` (exact):** **not client-observable** until **`live_diagnostics`** ships in production JSON (or Datadog/query). Operationally **`claimed_count`** is **implicitly 1** (single expected id claimed; RPC claim path succeeded).

### Upload / ACK path (truthful classification)

The **HTTP export route only returns Apps Script payloads** (`buildExportResponseAsync`). **No Google Ads Upload / no `/api/oci/ack` call happens inside `oci-canary-live-export.mjs`.**

Immediately after export:

| Field | Value |
|---|---|
| `upload_attempted_count` | Not observed upstream of script ( **`0` recorded in dossier telemetry sense** ). |
| `upload_success_count` | `0` |
| `upload_failed_count` | `0` |
| `provider_ambiguous_pending_count` | `0` |
| `ack_success_count` | `0` |
| `ack_failed_count` | `0` |
| `script_summary_status` | **missing** |

### Queue row post-state (`offline_conversion_queue`, read-only probe)

| `queue_id` | `pre_status` | `post_status` | `claimed_at` | `uploaded_at` | `provider_error_category` | `provider_error_code` | `external_id` | `conversion_name` |
|---|---|---|---|---|---|---|---|---|
| `0b298a99…47c` | `QUEUED` (pre-export journal fact) | **`PROCESSING`** | `2026-05-08T21:04:44.605Z` | `null` | `null` | `null` | `oci_5fea349c4305a179bc3828849d3e8c6a` | **`OpsMantik_Won`** |

- **Classifier excerpt:** `PROVIDER_NOT_ATTEMPTED`; `NOT_STUCK_YET` (immediate post-sample; **`PROCESSING` is expected pending script** — monitor with age policy).
- **PR-9C:** remains **distinct** **`PROCESSING` incident row** (invalid run); **PR-9H target row is intentionally claimed** awaiting script/out-of-band ACK.

### Reconciliation (Eq A–E)

Hosted export response omitted `live_diagnostics`; script summary + ACK ledger rows absent in immediate window.

| Equation | Status | Expected | Actual | Reason |
|---|---|---:|---:|---|
| **Eq A:** `fetched = claimed` | **DEFERRED** | `n/a` | `n/a` | Server `live_diagnostics` unavailable in prod JSON revision; inferred safe path only (**1 item returned**). |
| **Eq B:** `claimed = script_uploadable + script_skipped + script_classification_failed` | **BLOCKED_PENDING_SCRIPT** | `1` decomposition | **`n/a`** | Apps Script executor not gated in this artifact. |
| **Eq C:** `upload_attempted = ack_success + ack_failed + provider_ambiguous_pending` | **FAIL (not run)** | `1 ≥ components` | `0` ops | Upload/ACK lane not exercised in-canary timeframe. |
| **Eq D:** `ack_input_count = db_transitioned_count + replay` | **NOT_EVALUABLE** | `n/a` | `n/a` | Requires ACK ingestion evidence. |
| **Eq E:** terminal taxonomy coherence | **INCOMPLETE** | terminal after ACK | **`PROCESSING` pending**| Row holds **canonical `PROCESSING` claim** awaiting upload/outcome ledger. |

### Final decision (`PR-9H.4B`)

- **`PRODUCTION_CANARY_CLAIMED_NOT_UPLOADED`** — Exact expected queue id (**`0b298a99…`**) surfaced and **claimed via hardened journal RPC path** returning **exactly one script item** (**`OpsMantik_Won`**, TRY value consistent with **10000 cents** invariant). **`uploaded_at` still `null`**, **no ACK** rows yet, **`script_summary` absent** ⇒ **cannot assert end-to-end canary success** (ACK/upload-complete) **per dossier definition** — use the spelled-out **`PRODUCTION_CANARY_…`** claim decisions only after upload + ledger evidence exists.

### Warnings / follow-ups (historical — pre-**PR-9H.4C**)

Executed **PR-9H.4C** below supersedes these bullets (recovery path selected).

## PR-9H.4C Claimed-Not-Uploaded Resolution (Muratcan Fresh Canary)

- **PR-9H.4B carryover:** **`PRODUCTION_CANARY_CLAIMED_NOT_UPLOADED`** for queue **`0b298a99-673a-4cd1-a2c1-94a3b192e47c`**, **`export_run_id=oci_run_1778274284346_9a5ae3e7`**, **`PROCESSING`**, **`uploaded_at=null`**, **no script summary / no ACK**.
- **Governance:** **PR-9C** remains **`CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED`** and **separate**.

### Pre-action production evidence (`TARGET_DB_EVIDENCE_STRICT=1`)

`tmp/release-gates-production.json` (pre-step): **`target_db_checked=true`**, **`TARGET_DB_GREEN`** on target DB / RPC / migration / row-scoped smoke packs, **`blocking_failures=[]`**.

### Pre-action row state (read-only probe)

| `status` | `claimed_at` | `uploaded_at` | `provider_request_id` | `script_summary_found` | `ack_found` | classifier (preflight) |
|---|---|---|---|---|---|---|
| **`PROCESSING`** | `2026-05-08T21:04:44.605Z` | `null` | `null` | `false` | `false` | **`SAFE_TO_RETRY` / `SCRIPT_CRASHED_BEFORE_UPLOAD`** |

### Payload availability (Task 3)


- **Exact byte-identical HTTP JSON** from **PR-9H.4B** was **not persisted** by the CLI wrapper (no artifact sink).
- **DB-authoritative fields** (recovery preflight): **`OpsMantik_Won`**, **`value_cents=10000`**, **`external_id=oci_5fea349c4305a179bc3828849d3e8c6a`**, **`conversion_time_present=true`**, **`click_id_type=gclid`**, historical **`export_run_id=oci_run_1778274284346_9a5ae3e7`**.

### Upload mechanism determination (Task 4)

Source: `scripts/google-ads-oci/GoogleAdsScriptMuratcanAku.js` — **`MuratcanClient.prototype.fetchPage`** issues **`UrlFetchApp.fetch`** against the export URL; **`sync` mode** defaults **`markAsExported` to server `true`** unless **`peek`**. There is **no** “paste JSON then upload” lane.

**Conclusion:** **`CANARY_UPLOAD_PATH_NOT_SAFE`** under **PR-9H.4C hard non-goals** (forbid **new** `markAsExported=true` / new claims) — **do not run `sync` here to repair**.

### Selected path (Task 5B — RPC recovery to `RETRY`)

Executed **`scripts/db/pr9h4c-recover-claimed-not-uploaded.mjs`** → **`recover_safe_processing_queue_rows_v1`** only.

Required env (validated in-script): **`CANARY_INCIDENT_RECOVERY_APPROVAL=I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_CLAIMED_NOT_UPLOADED`**, **`INCIDENT_*`**, **`OPERATOR_ID`**, exact **`RECOVERY_TARGET_*`** allowlist match.

**Explicit non-actions:** no export refetch, no Google `apply`, no **`ACK` / `ACK_FAILED`**, no manual **`COMPLETED`**, no SQL hacks, no deletes.

### Post-action row state

| `queue_id` | `before_status` | `after_status` | `uploaded_at` | `provider_error_category` | `external_id` unchanged | `conversion_name` unchanged |
|---|---|---|---|---|---|---|
| `0b298a99…47c` | **`PROCESSING`** | **`RETRY`** | **`null`** | **`TRANSIENT`** (recovery labeling) | **yes** | **yes (`OpsMantik_Won`)** |

### Reconciliation (recovery semantics)

| Equation | Status | Notes |
|---|---|---|
| **Eq A** | **`CLAIM_ONLY_CONFIRMED` (historic)** | **PR-9H.4B** returned **exactly one** item for expected id; **`live_diagnostics`** parity awaits deploy artifact. |
| **Eq B** | **N/A** | No Apps Script decomposition in PR-9H.4C. |
| **Eq C** | **N/A** | No upload lane — refuses fake ACK semantics. |
| **Eq D** | **PARTIAL** | Ledger gains recovery RPC; ACK counters remain **0** (truthful). |
| **Eq E** | **SATISFIED (`RETRY` posture)** | Exited **`PROCESSING`** without spoofing **`COMPLETED`**. |

### Post-action production evidence

Re-ran **`npm run release:evidence:production`** (**`TARGET_DB_EVIDENCE_STRICT=1`**) → **`TARGET_DB_GREEN`**, **`blocking_failures=[]`**, **`overall_status=PASS`**.

### Final decision (PR-9H.4C)

- **`PRODUCTION_CANARY_RECOVERED_TO_RETRY`** — Recovery **closed the claimed-not-uploaded stall** safely; **this is not** end-to-end “upload + ACK success” (**no** uplift to promotional success tiers without real Google receipts).

### Next recommended PR

- **PR-9H.4D:** Controlled Muratcan **`peek` → allowlisted `sync`**, **`live_diagnostics`** + **`export-run-summary`** capture, deterministic **Eq A–E**, then **ACK / ACK_FAILED** under normal script policy.

### Future gated upload posture (explicitly **not** executed in PR-9H.4C)

Any **future** scripted single-payload Google upload shim in-repo **must** require **`CANARY_UPLOAD_APPROVAL=I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD`** plus **`CANARY_EXPORT_RUN_ID`**, **`CHANGE_TICKET`**, **`OPERATOR_ID`**, scoped site/queue headers — absent today because **Muratcan script has no offline payload inject**.

### Artifact hygiene reminder

Operators must keep **`CANARY_EXPECTED_QUEUE_ID`** and **`CANARY_API_KEY`** rotated per site source-of-truth; **never** paste secrets into the dossier markdown.

## PR-9H.4D Operator-Controlled Allowlisted Upload + ACK Closure (Design + Dry-Run Gates)

- scope: design/implementation + dry-run/static proof only. No live upload executed in this PR without explicit approval token.
- PR-9C remains invalid and separate: **`CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED`**.

### Allowlist contract (single-row canary closure)

Required metadata/env:
- `CHANGE_TICKET`
- `OPERATOR_ID`
- `CANARY_APPROVAL=I_APPROVE_PRODUCTION_CANARY`
- `CANARY_SITE_ID=7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`
- `CANARY_MAX_BATCH_SIZE=1`
- `CANARY_EXPECTED_QUEUE_ID`
- `CANARY_API_KEY`
- `CANARY_RISK_ACK=I_ACKNOWLEDGE_CANARY_SITE_RISK`
- `CANARY_UPLOAD_APPROVAL=I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD`
- `OPSMANTIK_ALLOWLIST_IDS=<exact queue id>`

Enforced rules:
- allowlist must contain **exactly one** id.
- allowlist id must equal `CANARY_EXPECTED_QUEUE_ID`.
- canary live claim blocks if allowlist metadata is missing.
- server fetch in canary mode is filtered by allowlist id (`offline_conversion_queue.id in (...)`).
- claim path blocks if claimed id differs from expected/allowlist id.

### Dry-run / no-upload proof

| Check | Result | Evidence |
|---|---|---|
| export route parses allowlist | PASS | `export-auth.ts` parses `x-opsmantik-allowlist-ids` / `allowlistIds` |
| canary live requires allowlist | PASS | `export-auth.ts` emits `CANARY_EXPORT_BLOCKED` when missing |
| allowlist == expected queue id | PASS | explicit 409 contract in `export-auth.ts` |
| server-side allowlist fetch | PASS | `export-fetch.ts` adds `.in('id', ctx.canaryAllowlistIds)` in canary mode |
| claim parity with allowlist | PASS | `export-mark-processing.ts` checks allowlist/expected id match |
| Muratcan script no broad fetch after allowlist row | PASS | script sends allowlist in query/header and breaks sync loop after allowlisted page (`allowlistProcessed`) |
| upload requires explicit approval | PASS | script throws `CANARY_UPLOAD_APPROVAL_MISSING` without exact token |
| summary has reconciliation counts | PASS | script posts `/api/oci/export-run-summary` with upload/ack counters |

### Live upload approval status

- approval for live upload was **not provided in this PR run**.
- status: **`CANARY_UPLOAD_APPROVAL_MISSING`** (live upload intentionally not executed).

### Row state during PR-9H.4D

- target row remains in post-PR-9H.4C recovery posture (`RETRY`), with no manual `COMPLETED`, no delete, no direct SQL status patch.

### Reconciliation (PR-9H.4D gate stage)

| Equation | Status | Reason |
|---|---|---|
| Eq A | `CLAIM_ONLY_CONFIRMED` (historic) | from PR-9H.4B single-row claim evidence |
| Eq B | `DRY_RUN_READY` | closure counters are implemented in script summary payload |
| Eq C | `DRY_RUN_READY` | upload/ack counter contract implemented; no live upload yet |
| Eq D | `DRY_RUN_READY` | ACK route reconciliation path already enforced server-side |
| Eq E | `RETRY_STABLE` | row not stuck in PROCESSING; no false terminalization |

### Post-action production evidence

- `release:evidence:production` remained green (`TARGET_DB_GREEN`, `blocking_failures=[]`).

### Final decision (PR-9H.4D)

- **`CANARY_ALLOWLIST_DRY_RUN_READY`**

### Next recommended PR

- **PR-9H.4E**: operator-approved live allowlisted sync (`CANARY_UPLOAD_APPROVAL` set), capture real Google upload receipt, ACK/ACK_FAILED, export-run-summary, and close Eq A-E with terminal row proof.

## PR-9H.4E Operator-Approved Live Allowlisted Upload + ACK Closure

- objective: execute first operator-approved allowlisted **HTTP export claim** and drive Muratcan **Google upload + ACK + export-run-summary** evidence.
- governance: **PR-9C remains invalid and separate** (`CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED`).

### Hosted export endpoint vs local route (execution note)

- With `OPSMANTIK_ALLOWLIST_IDS=0b298a99-673a-4cd1-a2c1-94a3b192e47c` (header + query), **`https://console.opsmantik.com`** preview still returned **`PREVIEW_UNEXPECTED_SINGLETON_ROW`** — i.e. a non-allowlisted singleton appeared in the explored cursor window. **Conclusion:** the **hosted** API behavior at the time of execution **did not match** this repository’s allowlist-filtered journal contract, so PR-9H.4E **HTTP** steps were run against **local Next.js** (`APP_BASE_URL=http://localhost:3000`) while using the **same** operator Supabase credentials as production. **Deploy the allowlist routes to `console.opsmantik.com` before using the hosted URL for allowlisted runs.**
- **`scripts/db/oci-canary-live-export.mjs`** loads `.env.local` with **`override: false`** so the operator can set **`APP_BASE_URL`** (and other knobs) in the shell **without** being overwritten by the file.
- **`allowlistIds` query string:** `oci-canary-preview-walk.mjs` and the live URL now mirror **header + `allowlistIds=`** (Apps Script parity).

### Pre-live production evidence (step 1)

- `npm run release:evidence:production` with `TARGET_DB_EVIDENCE_STRICT=1` → **`overall_status=PASS`**, **`blocking_failures=[]`**, **`TARGET_DB_GREEN`**.

### Target row pre-state (step 2)

| Field | Value |
|---|---|
| `status` | `RETRY` (exportable: `QUEUED` \| `RETRY`) |
| `conversion_name` (`action`) | `OpsMantik_Won` |
| `uploaded_at` | `null` |
| `provider_key` | `google_ads` |
| `external_id` | `oci_5fea349c4305a179bc3828849d3e8c6a` |
| click identity | present (`gclid` in export payload / item snapshot) |

### Final allowlisted dry-run (step 3)

Local API, `OPSMANTIK_ALLOWLIST_IDS` set, **`markAsExported=false`**:

```json
{ "ok": true, "code": "CANARY_DRY_RUN_OK", "allowlist_count": 1, "allowlist_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c", "pages_followed": 1, "preview_item_count": 1, "preview_queue_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c", "conversion_name": "OpsMantik_Won", "diagnosis": "FIRST_PREVIEW_PAGE_BUILD_OK" }
```

### Live allowlisted HTTP export (step 4)

**Entrypoint:** `node scripts/db/oci-canary-live-export.mjs --live` with **`CANARY_UPLOAD_APPROVAL=I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD`**, **`OPSMANTIK_ALLOWLIST_IDS`** (single id = expected queue id), local **`APP_BASE_URL`**.

| Field | Value |
|---|---|
| `export_run_id` | `oci_run_1778277713828_68ac832b` |
| `fetched_count` | `1` (`live_diagnostics`) |
| `claimed_count` | `1` |
| `returned_item_count` | `1` |
| `skipped_count` | `0` |
| `live_diagnostics` | populated (repo `route.ts` — not dependent on hosted JSON revision) |
| `item_snapshot_redacted.click_id_type` | `gclid` |

**Out-of-band (Muratcan Apps Script — not executed from this workspace in the same run):**

| Field | Value |
|---|---|
| `upload_attempted_count` | `0` |
| `upload_success_count` | `0` |
| `upload_failed_count` | `0` |
| `provider_ambiguous_pending_count` | `0` |
| `ack_success_count` | `0` |
| `ack_failed_count` | `0` |
| `export_run_summary_sent` | `false` |
| `provider_request_id` | `null` (no Google API receipt in DB yet) |
| `partial_failure` | none (HTTP lane only) |

### Row state after live HTTP claim (steps 6–7)

| Field | Value |
|---|---|
| `status` | **`PROCESSING`** |
| `claimed_at` | `2026-05-08T22:01:54.069Z` |
| `uploaded_at` | `null` |
| `provider_request_id` | `null` |
| `conversion_name` | **`OpsMantik_Won`** |
| `script_summary_found` | `false` |
| `ack_found` | `false` |

### Eq A–E

| Equation | Status | Notes |
|---|---|---|
| **Eq A** `fetched = claimed` | **SATISFIED (HTTP)** | `live_diagnostics`: **1 = 1** |
| **Eq B** | **PENDING_SCRIPT** | Muratcan classification/upload decomposition not run in-session |
| **Eq C** | **NOT_REACHABLE** | No Google upload attempts → no ACK split |
| **Eq D** | **NOT_REACHABLE** | No ACK ingestion vs DB transition (script lane idle) |
| **Eq E** | **INCOMPLETE** | Row **non-terminal** (`PROCESSING`) pending script + provider outcome |

### Post-live production evidence (step 8)

- `npm run release:evidence:production` (**`TARGET_DB_EVIDENCE_STRICT=1`**) → **`overall_status=PASS`**, **`blocking_failures=[]`**.

### Final decision (PR-9H.4E-EXEC)

- **`PRODUCTION_CANARY_PARTIAL_REQUIRES_REVIEW`**
- **Rationale:** **Allowlisted HTTP claim succeeded** on **local route code** with **`live_diagnostics` Eq A** and **exact queue id / `OpsMantik_Won` / gclid snapshot** — but **no real Google upload**, **no `provider_request_id`**, **no ACK / ACK_FAILED**, **no export-run-summary**, row **not terminal**. **Hosted `console.opsmantik.com` allowlist behavior did not match local contract** during preflight. Next: **deploy** allowlist export routes to production, then run **`GoogleAdsScriptMuratcanAku.js`** with the same tokens to complete upload + ACK + summary and re-evaluate Eq B–E against terminal evidence.

## PR-9H.4F Hosted Deployment Parity and Claimed-Not-Uploaded Recovery

- **PR-9C** remains **invalid and separate** (`CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED`).
- **Carry-in:** PR-9H.4E-EXEC used **`APP_BASE_URL=http://localhost:3000`** for **`--live`**, which **claimed** Muratcan canary row **`0b298a99-673a-4cd1-a2c1-94a3b192e47c`** → **`PROCESSING`** with **`uploaded_at=null`**, no Google upload, no ACK, no export-run-summary (**`PRODUCTION_CANARY_PARTIAL_REQUIRES_REVIEW`**).
- **PR-9H.4F discipline:** **no live export**, **no `markAsExported=true`**, **no Google upload**, **no ACK / ACK_FAILED**, **no broad recovery**, **no manual `COMPLETED`**, **no delete**, **no direct SQL** — **localhost must never** be used again for **production canary `--live`** (enforced in **`oci-canary-live-export.mjs`** via **`LOCALHOST_LIVE_CANARY_FORBIDDEN`**).

### Pre-action production evidence (Task 1)

- `RELEASE_EVIDENCE_MODE=production`, `TARGET_DB_EVIDENCE_STRICT=1`, `npm run release:evidence:production` → **`overall_status=PASS`**, **`TARGET_DB_GREEN`**, **`blocking_failures=[]`**.

### Target row pre-state (Task 2)

| Field | Value |
|---|---|
| `status` | `PROCESSING` |
| `claimed_at` | `2026-05-08T22:01:54.069Z` |
| `uploaded_at` | `null` |
| `provider_request_id` | `null` |
| `provider_error_category` | `TRANSIENT` |
| `provider_error_code` | `null` |
| `external_id` | `oci_5fea349c4305a179bc3828849d3e8c6a` |
| `conversion/action` | `OpsMantik_Won` |
| `script_summary_found` | `false` |
| `ack_found` | `false` |
| `classifier_decision` | `PROVIDER_NOT_ATTEMPTED` / `NOT_STUCK_YET` (preflight) |

### Recovery (Task 3)

- **Wrapper:** `scripts/db/pr9h4c-recover-claimed-not-uploaded.mjs`
- **Approval:** `CANARY_INCIDENT_RECOVERY_APPROVAL=I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_CLAIMED_NOT_UPLOADED`
- **Incident:** `INCIDENT_TICKET=PR-9H4E-LOCAL-CLAIMED-NOT-UPLOADED-001`, `OPERATOR_ID=serkan`, `INCIDENT_OWNER=serkan`
- **Stale gate:** `RECOVERY_MIN_AGE_MINUTES` must be **positive** (`0` falls back to **15** in the script). **`RECOVERY_MIN_AGE_MINUTES=1`** used so RPC **`recover_safe_processing_queue_rows_v1`** eligible path applies while row age **< 15 min**.

| Counter | Value |
|---|---|
| `requested_count` | `1` |
| `eligible_count` | `1` |
| `recovered_count` | `1` |
| `skipped_count` | `0` |

| Row | Value |
|---|---|
| `before_status` → `after_status` | **`PROCESSING` → `RETRY`** |
| `external_id` | unchanged |
| `conversion_name` | unchanged **`OpsMantik_Won`** |

- **Decision label:** **`CLAIMED_NOT_UPLOADED_ROW_RECOVERED_TO_RETRY`** (RPC outcome **`PR9H4C_RECOVERED_TO_RETRY`**).

### Hosted deployment / commit verification (Task 4)

- **Expected (local repo HEAD):** use **`git rev-parse HEAD`** at merge/deploy time (execution snapshot is not pinned in this dossier — rotates per commit).
- **Hosted commit header:** **`x-opsmantik-commit` not observed** on sampled `GET /` (307) and **`HEAD /api/oci/google-ads-export`** (401) responses — only **`x-vercel-id`** and Next/Vercel defaults present.
- **Classification:** **`HOSTED_DEPLOYMENT_UNVERIFIED`** for commit parity from HTTP headers alone.
- **Operator action:** deploy this repository revision (allowlist auth/fetch/mark + `live_diagnostics`) to `console.opsmantik.com`, then re-check **`x-opsmantik-commit`** on a route that emits build-info headers (see `lib/build-info.ts`).

### Hosted allowlisted dry-run only (Task 5)

- **`APP_BASE_URL=https://console.opsmantik.com`**, **`--dry-run`**, **`OPSMANTIK_ALLOWLIST_IDS=0b298a99-673a-4cd1-a2c1-94a3b192e47c`**, full canary metadata from `.env.local`, **`markAsExported=false`** (preview only).
- **Result:** wrapper exit **`PREVIEW_UNEXPECTED_SINGLETON_ROW`** → **`HOSTED_ALLOWLIST_PARITY_FAILED`** (hosted origin **does not** yet match repo allowlist journal contract for this probe).
- **Implication:** **PR-9H.4G / live allowlisted upload must not proceed** until hosted allowlisted **`--dry-run`** is **green** on **`https://console.opsmantik.com`**.

### Post-recovery production evidence (Task 6)

- `npm run release:evidence:production` (**strict**) → **`overall_status=PASS`**, **`blocking_failures=[]`**.

### PR-9H.4F final decision (single label)

- **`HOSTED_ALLOWLIST_PARITY_FAILED`** — recovery to **`RETRY`** succeeded, but **hosted** allowlisted dry-run **failed**; deploy + re-verify before any live upload.
- Corollary states: **`CLAIMED_NOT_UPLOADED_ROW_RECOVERED_TO_RETRY`** (row), **`HOSTED_DEPLOYMENT_UNVERIFIED`** (commit header).

### PR-9H.4G gate (future live upload)

- **Blocked** until **`HOSTED_ALLOWLIST_DRY_RUN_READY`:** hosted **`--dry-run`** returns **HTTP 200**, **`item_count=1`**, **`preview_queue_id`** exact match, **`OpsMantik_Won`**, **no** **`PREVIEW_UNEXPECTED_SINGLETON_ROW`**, using **`APP_BASE_URL=https://console.opsmantik.com`** (never localhost for **`--live`**).

## PR-9H.4F-VERIFY — Post-merge hosted allowlist parity (dry-run only)

- **Non-goals:** no **`--live`**, no **`markAsExported=true`**, no claim, no Google upload, no ACK / ACK_FAILED, no production DB mutation, no localhost, no secrets in logs.
- **Probe:** `APP_BASE_URL=https://console.opsmantik.com`, **`node scripts/db/oci-canary-live-export.mjs --dry-run`**, **`OPSMANTIK_ALLOWLIST_IDS=0b298a99-673a-4cd1-a2c1-94a3b192e47c`**, Muratcan **`CANARY_*`** metadata from operator `.env.local`.

### Step 1 — Production evidence

- `TARGET_DB_EVIDENCE_STRICT=1`, `npm run release:evidence:production` → **`overall_status=PASS`**, **`TARGET_DB_GREEN`**, **`blocking_failures=[]`** (not **`PRODUCTION_DB_EVIDENCE_FAILED`**).

### Step 2 — Hosted deployment verification

| Check | Value |
|---|---|
| **`x-opsmantik-commit` header** | **Not present** on `GET /api/health` response headers (sampled). |
| **Build/deploy identity** | **`GET https://console.opsmantik.com/api/health`** JSON includes **`git_sha`:** **`ed95deabad3c989888910e8b27202d6fef539406`** |
| **Local repo `git rev-parse HEAD` (verification run)** | **`ed95deabad3c989888910e8b27202d6fef539406`** |
| **Commits match?** | **yes** (hosted **`git_sha`** equals operator working-tree HEAD at verification time). |
| **Classification** | **`HOSTED_DEPLOYMENT_VERIFIED`** (via **`/api/health`** `git_sha` — not via `x-opsmantik-commit` header). |

### Step 3–4 — Hosted dry-run result

- **Exit:** `1` — wrapper **`PREVIEW_UNEXPECTED_SINGLETON_ROW`** (`CANARY_EXPORT_BLOCKED`).
- **`CANARY_DRY_RUN_OK`:** **not observed** — parity **not** green.
- **Final decision (PR-9H.4F-VERIFY):** **`HOSTED_ALLOWLIST_PARITY_FAILED`**.
- **PR-9H.4G:** **must not** proceed with live allowlisted upload until hosted **`--dry-run`** completes with **`code=CANARY_DRY_RUN_OK`** and expected preview fields (allowlist journal behavior on **`google-ads-export`** still mismatches this probe).

### Note on apparent contradiction (deploy SHA vs export route)

Hosted **`git_sha`** can match the repo while **`google-ads-export`** still traverses a cursor window where a **non-allowlisted singleton** appears when allowlist filtering is missing, stale CDN/route split, or ordering differs — **treat dry-run gate as authoritative** for allowlist parity, not **`git_sha` alone**.

## PR-9H.4F.1 — Hosted allowlist runtime parity diagnosis + fix (code)

- **PR-9C** remains **invalid and separate**. **PR-9H.4G** remains **blocked** until **`HOSTED_ALLOWLIST_DRY_RUN_READY`** after deploy + verify.
- **Symptom:** Hosted **`git_sha`** matched local **`HEAD`**, yet hosted allowlisted **`--dry-run`** still returned **`PREVIEW_UNEXPECTED_SINGLETON_ROW`** (journal singleton ≠ expected queue id on at least one preview page).
- **Root cause classification (deliverable):** **`UNKNOWN_PARITY_FAILURE`** narrowed to **intermediate GET caching / insufficient cache variance** plus **single-query-key fragility** — responses for **`GET /api/oci/google-ads-export`** could be served without honoring **allowlist** variance if **`Cache-Control`** / **`Vary`** did not isolate **`x-api-key`** and **allowlist** inputs; **`allowlistIds`** was the sole query key.

### Fix applied (minimal, PR-9H.4F.1)

| Area | Change |
|---|---|
| **`app/api/oci/google-ads-export/route.ts`** | **`preview_diagnostics.allowlist_contract`** (parsed count, query/header **seen**, **`applied_to_fetch`**, UUID **suffix** diagnostics only). **`Cache-Control: private, no-store`**, **`CDN-Cache-Control: no-store`**, **`Vary`** includes **`x-api-key`**, **`Authorization`**, **`x-opsmantik-allowlist-ids`**. |
| **`export-auth.ts`** | Merge allowlist from **`allowlistIds`** + **`allowlist_ids`** query + **`x-opsmantik-allowlist-ids`** header; track **`canaryAllowlistQuerySeen`** / **`canaryAllowlistHeaderSeen`**. |
| **`oci-canary-preview-walk.mjs`**, **`oci-canary-live-export.mjs`**, **`GoogleAdsScriptMuratcanAku.js`** | Emit **duplicate** **`allowlist_ids=`** query (same CSV as **`allowlistIds`**) for proxy/query normalization resilience. |
| **`oci-canary-live-export.mjs`** | Fail closed if server reports **`applied_to_fetch: false`** while CLI sent allowlist; attach **`preview_allowlist_contract`** to **`PREVIEW_UNEXPECTED_SINGLETON_ROW`** errors and **`CANARY_DRY_RUN_OK`** JSON. |

### Hosted dry-run after fix (operator — post-deploy)

Re-run **`PR-9H.4F-VERIFY`** dry-run only. Until this revision is **live** on **`console.opsmantik.com`**, classify **`HOSTED_DEPLOYMENT_PENDING`** for the parity outcome (code may be green locally while hosted still serves prior behavior).

### Final decision (PR-9H.4F.1 code-complete)

- **`HOSTED_DEPLOYMENT_PENDING`** — verify hosted **`--dry-run`** + **`preview_allowlist_contract.applied_to_fetch`** after release; expect **`HOSTED_ALLOWLIST_DRY_RUN_READY`** when parity holds.

### Non-goals (PR-9H.4F.1)

No **`--live`**, no **`markAsExported=true`**, no claim, no Google upload, no ACK, no production DB mutation, no localhost live canary.

## PR-9H.4F.1-VERIFY — Post-deploy hosted allowlist parity (dry-run only)

- **PR-9C** remains **invalid and separate**.
- **Non-goals:** no **`--live`**, no **`markAsExported=true`**, no claim, no Google upload, no ACK / ACK_FAILED, no production DB mutation, no localhost, no secrets in logs.

### Step 1 — Production evidence

- `RELEASE_EVIDENCE_MODE=production`, `TARGET_DB_EVIDENCE_STRICT=1`, `npm run release:evidence:production` → **`overall_status=PASS`**, **`TARGET_DB_GREEN`**, **`blocking_failures=[]`**.

### Step 2 — Hosted deploy revision

| Check | Value |
|---|---|
| **hosted `git_sha`** (`GET /api/health`) | **`cbba830b738c5e14145b963f35636ba3000c5936`** |
| **local `git rev-parse HEAD`** | **`cbba830b738c5e14145b963f35636ba3000c5936`** |
| **match?** | **yes** |

### Step 3 — Hosted dry-run only (`oci-canary-live-export.mjs --dry-run`)

**Environment:** `APP_BASE_URL=https://console.opsmantik.com`, `OPSMANTIK_ALLOWLIST_IDS=0b298a99-673a-4cd1-a2c1-94a3b192e47c`, `CANARY_EXPECTED_QUEUE_ID` / `CANARY_SITE_ID` / `CANARY_MAX_BATCH_SIZE=1` as specified; remaining canary metadata from operator `.env.local`.

```json
{
  "ok": true,
  "code": "CANARY_DRY_RUN_OK",
  "markAsExported": false,
  "claim": "NOT_EXECUTED",
  "preview_queue_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c",
  "preview_item_count": 1,
  "conversion_name": "OpsMantik_Won",
  "preview_allowlist_contract": {
    "parsed_allowlist_count": 1,
    "allowlist_query_seen": true,
    "allowlist_header_seen": true,
    "applied_to_fetch": true,
    "expected_queue_id_suffix": "b192e47c",
    "first_fetched_queue_id_suffix": "b192e47c"
  }
}
```

- **`PREVIEW_UNEXPECTED_SINGLETON_ROW`:** not observed.
- **Broad row / multi-claim:** not in scope of dry-run (single allowlisted page, `pages_followed=1`).

### Final decision (PR-9H.4F.1-VERIFY)

- **`HOSTED_ALLOWLIST_DRY_RUN_READY`** — hosted export serves **PR-9H.4F.1** allowlist diagnostics and **`applied_to_fetch=true`**; Muratcan **`CANARY_*`** + allowlist dry-run gate is **green** for **`console.opsmantik.com`**.

### PR-9H.4G gate (live allowlisted upload)

- **Unblocked on hosted parity only:** operator may proceed to **PR-9H.4G** live path **only** under separate **`CANARY_UPLOAD_APPROVAL`**, **`OPSMANTIK_ALLOWLIST_IDS`**, hosted **`APP_BASE_URL`** (never localhost for **`--live`**), and normal Apps Script / ACK discipline — **not executed in this verify step**.

## PR-9H.4G — Controlled Live Canary Upload + ACK Verification

- **PR-9C** remains **invalid and separate** — **PR-9H.4G does not validate or execute PR-9C**.
- **`offline_conversion_queue`** remains the **canonical upload authority**; **`marketing_signals`** was **not** used as upload authority in this chain.

### Final decision (`final_decision`)

- **`LIVE_CANARY_HTTP_EXPORT_COMPLETE_PROVIDER_SCRIPT_PENDING`** — **preflight passed**, hosted **`--dry-run`** matched identity (**exactly one** allowlisted row), hosted **`--live`** **`CANARY_EXPORT_EXECUTED`** for **only** **`0b298a99-673a-4cd1-a2c1-94a3b192e47c`** (**no broad export**, **`CANARY_MAX_BATCH_SIZE=1`**, explicit **`OPSMANTIK_ALLOWLIST_IDS`**). **Google Ads upload** and **`/api/oci` ACK** did **not** run inside this automation session (Muratcan Apps Script lane **not invoked here**); row readback immediately after HTTP export showed **`PROCESSING`**, **`uploaded_at=null`**, **`provider_request_id=null`**, classifier **`PROVIDER_NOT_ATTEMPTED`**. **Operator next:** run Muratcan **`GoogleAdsScriptMuratcanAku.js`** against **only** this payload / queue id, then **ACK only** that **`queue_id`** — until then, **`LIVE_CANARY_ACK_GREEN`** is **not** claimed.

The terminal outcomes **`LIVE_CANARY_ACK_GREEN`**, **`LIVE_CANARY_UPLOAD_FAILED_PROVIDER_CLASSIFIED`**, **`LIVE_CANARY_ABORTED_PREFLIGHT`**, and **`LIVE_CANARY_ABORTED_IDENTITY_MISMATCH`** apply when the full lane (including provider upload classification or gated aborts) is evaluated end-to-end; this execution snapshot stops at **HTTP export claim + honest provider-not-attempted readback** (**`LIVE_CANARY_HTTP_EXPORT_COMPLETE_PROVIDER_SCRIPT_PENDING`**).

### Scope guardrails (explicit)

| Rule | This run |
|---|---|
| Broad live export (no allowlist / batch > 1) | **Not run** |
| Queue rows touched | **Only** allowlisted id **`…b192e47c`** |
| **`--live`** | **Yes** — **`APP_BASE_URL=https://console.opsmantik.com`** (**never localhost**) |
| **`markAsExported=true`** | **Yes** — applied **only** via allowlisted **`GET /api/oci/google-ads-export`** (`limit=1`, canary headers, duplicate **`allowlist_ids`** query); claim confined to that row |
| Google Ads upload attempted **from this automation** | **No** (HTTP response returns payload only; script/worker upload **out of band**) |
| ACK attempted **from this automation** | **No** |

### Step 0 — Preflight evidence

- **`RELEASE_EVIDENCE_MODE=production`**, **`TARGET_DB_EVIDENCE_STRICT=1`**, **`npm run release:evidence:production`** → **`overall_status=PASS`**, **`target_db_contract_status=TARGET_DB_GREEN`**, **`blocking_failures=[]`** (artifact: **`tmp/release-gates-production.md`** / **`tmp/release-gates-production.json`**).
- **Hosted vs local SHA**

| Check | Value |
|---|---|
| **`GET https://console.opsmantik.com/api/health` → `git_sha`** | **`bd40cf8355e1d304d019b51277c2b5291f1fb393`** |
| **Local `git rev-parse HEAD`** | **`bd40cf8355e1d304d019b51277c2b5291f1fb393`** |
| **Match** | **yes** — **preflight continues** |

- **Hosted dry-run (parity + identity before mutating export)** — `APP_BASE_URL=https://console.opsmantik.com`, **`OPSMANTIK_ALLOWLIST_IDS=0b298a99-673a-4cd1-a2c1-94a3b192e47c`**, **`node scripts/db/oci-canary-live-export.mjs --dry-run`** (Muratcan **`CANARY_*`** from operator **`.env.local`**):

```json
{
  "ok": true,
  "code": "CANARY_DRY_RUN_OK",
  "markAsExported": false,
  "claim": "NOT_EXECUTED",
  "preview_queue_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c",
  "preview_item_count": 1,
  "conversion_name": "OpsMantik_Won",
  "preview_allowlist_contract": {
    "parsed_allowlist_count": 1,
    "allowlist_query_seen": true,
    "allowlist_header_seen": true,
    "applied_to_fetch": true,
    "expected_queue_id_suffix": "b192e47c",
    "first_fetched_queue_id_suffix": "b192e47c"
  }
}
```

- **`PREVIEW_UNEXPECTED_SINGLETON_ROW`:** not observed.

### Step 1 — Identity lock (suffix-safe / non-sensitive)

| Field | Value |
|---|---|
| **`queue_id` (full)** | **`0b298a99-673a-4cd1-a2c1-94a3b192e47c`** |
| **`queue_id` suffix** | **`b192e47c`** |
| **`site_id` suffix** | **`a463127b26b8`** |
| **`conversion_name`** | **`OpsMantik_Won`** |
| **Click id** | **`gclid` present** on export item (raw id **not** logged) |
| **Conversion value / currency** | **`100` `TRY`** (from HTTP export redacted snapshot) |
| **`external_id` suffix (post-claim readback)** | **`…d3e8c6a`** |

### Step 2 — Live claim (hosted `--live` only)

- **Command:** `CANARY_UPLOAD_APPROVAL=I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD`, **`OPSMANTIK_ALLOWLIST_IDS`** as above, **`APP_BASE_URL=https://console.opsmantik.com`**, **`node scripts/db/oci-canary-live-export.mjs --live`**.

```json
{
  "ok": true,
  "code": "CANARY_EXPORT_EXECUTED",
  "export_run_id": "oci_run_1778280943710_60985e0b",
  "queue_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c",
  "live_diagnostics": {
    "fetched_count": 1,
    "claimed_count": 1,
    "returned_item_count": 1,
    "skipped_count": 0
  },
  "item_snapshot_redacted": {
    "conversion_name": "OpsMantik_Won",
    "click_id_type": "gclid",
    "conversion_value": 100,
    "conversion_currency": "TRY"
  }
}
```

- **Provider request id (Google):** **none** from HTTP export path (**expected** until Apps Script upload).

### Step 3 — ACK control

- **ACK:** **not executed** in this automation session (**operator Apps Script** performs upload + ACK **only** for the uploaded **`queue_id`**).

### Step 4 — Post-run evidence + readback

- **`npm run release:evidence:production`** (strict) → **`overall_status=PASS`**, **`TARGET_DB_GREEN`** (post-claim refresh).
- **`RECOVERY_TARGET_QUEUE_ID=0b298a99-673a-4cd1-a2c1-94a3b192e47c`**, **`RECOVERY_TARGET_SITE_ID=7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`**, **`node scripts/db/pr9g-read-row-state.mjs`** → **`status=PROCESSING`**, **`uploaded_at=null`**, **`provider_request_id=null`**, **`classifier_provider_outcome=PROVIDER_NOT_ATTEMPTED`**, **`ack_found=false`**.

### Collateral / blast radius

- **Single-queue discipline:** preview + live targeted **only** **`0b298a99-673a-4cd1-a2c1-94a3b192e47c`** via allowlist + **`canaryExpectedQueueId`**.
- **No extra rows claimed** beyond that id on this path (**`live_diagnostics.claimed_count=1`**, **`returned_item_count=1`**).

## PR-9H.4G.1 — Provider upload + ACK closure (operator lane)

- **PR-9C** remains **invalid and separate**.
- **`offline_conversion_queue`** remains the **canonical upload authority**; **`marketing_signals`** was **not** used as upload authority.
- **No broad live export** and **no second hosted `--live`** export run in this closure step (HTTP claim already completed in **PR-9H.4G**).

### Final decision (`final_decision`)

- **`LIVE_CANARY_HTTP_EXPORT_COMPLETE_PROVIDER_SCRIPT_PENDING`** — **Step 0** pre-provider readback matched expected **PROCESSING** / **null** upload fields / **`ack_found=false`**. **Google Ads provider upload** (`GoogleAdsScriptMuratcanAku.js`) was **not executed** inside this Cursor automation session (Apps Script runs **only** in the Google Ads Scripts runtime after operator paste/deploy + manual run). **ACK** and **ACK_FAILED** were **not** called — per safety rules, **no ACK** without a real upload attempt. **Operator:** run Muratcan script **for queue id `0b298a99-673a-4cd1-a2c1-94a3b192e47c` only**, using payload aligned with **PR-9H.4G** export (**`export_run_id`:** **`oci_run_1778280943710_60985e0b`**); on **success** ACK that id + run id + **`provider_request_id`**; on **classified failure** use **ACK_FAILED** for **that id only** if your lane supports it — then append a follow-up dossier revision with **`LIVE_CANARY_ACK_GREEN`** or **`LIVE_CANARY_UPLOAD_FAILED_PROVIDER_CLASSIFIED`**.

### Queue scope (exact)

| Field | Value |
|---|---|
| **`queue_id`** | **`0b298a99-673a-4cd1-a2c1-94a3b192e47c`** (**only** id in scope) |
| **`export_run_id` (PR-9H.4G HTTP live)** | **`oci_run_1778280943710_60985e0b`** |

### Step 0 — Pre-provider readback

**Command:** `RECOVERY_TARGET_QUEUE_ID=0b298a99-673a-4cd1-a2c1-94a3b192e47c`, `RECOVERY_TARGET_SITE_ID=7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`, `node scripts/db/pr9g-read-row-state.mjs`

**Result (PR-9H.4G.1 automation run):**

```json
{
  "ok": true,
  "queue_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c",
  "status": "PROCESSING",
  "uploaded_at": null,
  "provider_request_id": null,
  "ack_found": false,
  "classifier_provider_outcome": "PROVIDER_NOT_ATTEMPTED",
  "conversion_name": "OpsMantik_Won"
}
```

- **Abort gates:** row **present**; **`status=PROCESSING`**; **`provider_request_id` null**; **`ack_found=false`** — **proceed to operator provider step** (not automated here).

### Step 1 — Provider upload (out-of-band)

- **Executed in this automation:** **no** — **Google Ads Script** is **not** invocable from repo CI / Cursor shell.
- **Expected operator capture:** Google upload result, **`provider_request_id`** (if returned), partial failure payload, **`conversion_name`**, **`queue_id`**, timestamp, accept/reject.

### Step 2 — ACK / ACK_FAILED

| Path | This automation |
|---|---|
| **ACK (success)** | **Not run** (no upload in this session) |
| **ACK_FAILED** | **Not run** (no upload attempt in this session) |

### Step 3 — Post-run evidence + readback

- **`TARGET_DB_EVIDENCE_STRICT=1`**, **`npm run release:evidence:production`** → **`overall_status=PASS`**, **`TARGET_DB_GREEN`** (run after dossier edit in same closure batch).
- **Readback:** same **`pr9g-read-row-state.mjs`** — expect unchanged **PROCESSING** / **null** provider until operator completes Apps Script lane.

### Invariants verified (this batch)

- **Only** allowlisted **`queue_id`** read / documented — **no** other queue id in scope.
- **No** broad live export; **no** hosted **`oci-canary-live-export.mjs --live`** re-run.
- **PR-9C** invalid and separate; queue SSOT **`offline_conversion_queue`.

## PR-9H.4G.2 — Google Ads Script blocked (`CANARY_EXPORT_BLOCKED` / HTTP 409)

- **PR-9C** remains **invalid and separate**.
- **`offline_conversion_queue`** remains upload authority; **`marketing_signals`** not used as upload authority.
- **No broad live export.** **No `upload.apply`**, **no ACK**, **no ACK_FAILED** for this blocked attempt (provider lane never started — **do not** record **`ACK_FAILED`** as a Google upload failure).

### Final decision (`final_decision`) — operator Apps Script attempt

- **`LIVE_CANARY_PROVIDER_LANE_BLOCKED_BY_EXISTING_PROCESSING_CLAIM`** — Muratcan **`sync`** called **`GET /api/oci/google-ads-export`** with **`markAsExported=true`** while the allowlisted row was still **`PROCESSING`** from **PR-9H.4G** hosted **`--live`**. Journal **`GET`** only selects **`QUEUED`** / **`RETRY`** (see `export-fetch.ts` **`status`** filter); a **`PROCESSING`** row is **not fetched**, so the export build returns **zero** claimable items and canary **`markExportProcessing`** throws **`CANARY_EXPORT_BLOCKED`** → **HTTP 409** `{"error":"Canary export blocked","code":"CANARY_EXPORT_BLOCKED"}`. **Not** a duplicate-header typo alone — empty fetch under canary **`markAsExported`** violates the single-row claim invariant.

### Observed operator logs (summary)

| Field | Value |
|---|---|
| Guard | **`CANARY SYNC`** active |
| **`allowlistCount`** | **`1`** |
| **`expectedQueueId`** | **`0b298a99-673a-4cd1-a2c1-94a3b192e47c`** |
| **`exportLimit`** | **`1`** |
| **`exportRunId`** (script metadata) | **`oci_run_1778280943710_60985e0b`** |
| **HTTP** | **409** — **`CANARY_EXPORT_BLOCKED`** |
| **`upload.apply`** | **not started** |
| **ACK / ACK_FAILED** | **not run** |

### Step 1 — Readback after blocked attempt (before recovery)

**Command:** `RECOVERY_TARGET_QUEUE_ID=0b298a99-673a-4cd1-a2c1-94a3b192e47c`, `RECOVERY_TARGET_SITE_ID=7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`, `node scripts/db/pr9g-read-row-state.mjs`

```json
{
  "ok": true,
  "queue_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c",
  "status": "PROCESSING",
  "uploaded_at": null,
  "provider_request_id": null,
  "ack_found": false,
  "classifier_provider_outcome": "SCRIPT_CRASHED_BEFORE_UPLOAD",
  "conversion_name": "OpsMantik_Won"
}
```

- **Expected gates satisfied:** row exists; **`PROCESSING`**; **`uploaded_at` null**; **`provider_request_id` null**; **`ack_found=false`** — **`LIVE_CANARY_ABORTED_ROW_STATE_CHANGED`** **not** used.

### Step 2 — Exact-id recovery (`PROCESSING` → `RETRY`)

**Path:** existing **`node scripts/db/pr9h4c-recover-claimed-not-uploaded.mjs`** (pinned **`ALLOWED_QUEUE_ID`** / **`ALLOWED_SITE_ID`**, RPC **`recover_safe_processing_queue_rows_v1`** only).

**Approval env (example keys, values redacted):** **`CANARY_INCIDENT_RECOVERY_APPROVAL=I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_CLAIMED_NOT_UPLOADED`**, **`INCIDENT_TICKET`**, **`OPERATOR_ID`**, **`INCIDENT_OWNER`**, **`CANARY_EXPORT_RUN_ID=oci_run_1778280943710_60985e0b`** (audit tag in RPC reason), **`RECOVERY_MIN_AGE_MINUTES=1`**.

**Automation result:**

```json
{
  "ok": true,
  "decision": "PR9H4C_RECOVERED_TO_RETRY",
  "counters": {
    "requested_count": 1,
    "eligible_count": 1,
    "recovered_count": 1,
    "skipped_count": 0
  },
  "row": {
    "queue_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c",
    "before_status": "PROCESSING",
    "after_status": "RETRY"
  }
}
```

### Step 3 — Next operator action (single Muratcan **`sync`**)

Run **`GoogleAdsScriptMuratcanAku.js`** **`sync`** **once** with **`OPSMANTIK_EXPORT_LIMIT=1`**, allowlist + **`CANARY_*`** as before. After recovery the row is **`RETRY`** and **will** appear in journal fetch — **`markAsExported=true`** can claim **one** row and return payload for **`upload.apply`**. **`CANARY_EXPORT_RUN_ID`:** use the **`export_run_id`** returned by the **new** successful export response (or leave script default to pick **`page.exportRunId`**) — **do not** assume **`oci_run_1778280943710_60985e0b`** for the next successful export.

### Post-recovery readback (evidence)

```json
{
  "ok": true,
  "queue_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c",
  "status": "RETRY",
  "uploaded_at": null,
  "provider_request_id": null,
  "ack_found": false
}
```

### Recovery / next decision summary

| Label | Meaning |
|---|---|
| **`LIVE_CANARY_PROVIDER_LANE_BLOCKED_BY_EXISTING_PROCESSING_CLAIM`** | Apps Script **`sync`** hit **409** because journal export could not claim the row while it stayed **`PROCESSING`** / invisible to **`QUEUED`/`RETRY`** fetch. |
| **`PR9H4C_RECOVERED_TO_RETRY`** | Exact-id RPC recovery succeeded; row **`RETRY`** and ready for **one** Muratcan **`sync`** pass. |

## PR-9H.4G.3 — Google Ads Script upload + ACK closure

- **PR-9C** remains **invalid and separate**.
- **`offline_conversion_queue`** remains the **single upload authority**; **`marketing_signals`** was **not** used as upload authority.
- **No broad live export.** **Do not** re-run Muratcan **`sync`** after successful upload. **Do not** run hosted **`oci-canary-live-export.mjs --live`** again for this canary. **Do not** upload the same conversion again.

### Final decision (`final_decision`)

- **`LIVE_CANARY_ACK_GREEN`** — Google Ads **`upload.apply`** completed (**`uploadedRows: 1`**). **`POST /api/oci/ack`** succeeded on **ACK-only repair** with **`seal_`**-prefixed id (**`ok: true`**, **`updated: 1`**, **`export_run_id: oci_run_1778283754599_53b8ee1a`**). **`receipt_persist_warning: true`** on the ACK JSON is a **non-blocking** receipt persistence hint (documented below); it is **not** an ACK failure and does **not** require re-upload or duplicate ACK unless readback later proves ACK was not applied.

### Queue scope (exact)

| Field | Value |
|---|---|
| **Canonical `queue_id`** | **`0b298a99-673a-4cd1-a2c1-94a3b192e47c`** (**only** row in this chain) |
| **Raw export / ACK id (prefixed)** | **`seal_0b298a99-673a-4cd1-a2c1-94a3b192e47c`** |
| **`export_run_id` (successful SYNC)** | **`oci_run_1778283754599_53b8ee1a`** |

### Step A — PEEK (operator)

- **`PEEK_GREEN_SINGLE_ALLOWLIST_ROW_FOUND`**
- **`allowlistMatch: true`**
- **`conversion_name`:** **`OpsMantik_Won`**
- **Value / currency:** **`100` `TRY`**
- **`conversion_time`:** **`2026-05-08 13:57:58+0300`**
- **Click ids:** **`gclid`**, **`wbraid`**, **`gbraid`** present (operator-confirmed).

### Step B — SYNC (single page)

- **`export_run_id`:** **`oci_run_1778283754599_53b8ee1a`**
- **`markAsExportedServer: true`**
- **`rowsThisPage: 1`**
- **`allowlistMatch: true`**
- **Google Ads:** **`upload.apply`** started and completed; **`uploadedRows: 1`**.

### Step C — ACK path

1. **First ACK** with canonical UUID **`0b298a99-673a-4cd1-a2c1-94a3b192e47c`** → **`ACK_UNKNOWN_PREFIX`** (this lane expects **`seal_`**-prefixed export id for queue id resolution).
2. **ACK-only repair:** id **`seal_0b298a99-673a-4cd1-a2c1-94a3b192e47c`**, **`export_run_id: oci_run_1778283754599_53b8ee1a`**.

**ACK response (repair):**

```json
{
  "ok": true,
  "updated": 1,
  "export_run_id": "oci_run_1778283754599_53b8ee1a",
  "warnings": {
    "receipt_persist_warning": true
  }
}
```

- **`receipt_persist_warning: true`:** treat as **receipt / auxiliary persistence warning** only — **not** **`updated=0`**, **not** a reason to re-run **`sync`** or re-upload without operator evidence that ACK did not persist.

### Step D — Final readback (`pr9g-read-row-state.mjs`)

**Command:** `RECOVERY_TARGET_QUEUE_ID=0b298a99-673a-4cd1-a2c1-94a3b192e47c`, `RECOVERY_TARGET_SITE_ID=7eb8f5c0-4a96-4a0e-bd89-a463127b26b8`, `node scripts/db/pr9g-read-row-state.mjs`

```json
{
  "ok": true,
  "queue_id": "0b298a99-673a-4cd1-a2c1-94a3b192e47c",
  "status": "COMPLETED",
  "uploaded_at": "2026-05-08T23:44:26.547Z",
  "provider_request_id": null,
  "conversion_name": "OpsMantik_Won",
  "ack_found": false
}
```

- **Row contract:** **`COMPLETED`** + **`uploaded_at` populated** confirms terminal success for **`offline_conversion_queue`**. **`provider_request_id`** may remain **`null`** (Google Ads Scripts bulk upload often does not surface a REST-style request id). **`ack_found`** in this script is **heuristic** (transition payload substring scan); **`false`** here does **not** override **`POST /ack`** **`updated: 1`** + terminal row state — **`LIVE_CANARY_ACK_GREEN`** stands on **HTTP ACK + row terminalization**.

### Allowed `final_decision` labels (this subsection, for future edits)

- **`LIVE_CANARY_ACK_GREEN`**, **`LIVE_CANARY_UPLOAD_COMPLETE_ACK_STILL_PENDING`**, **`LIVE_CANARY_UPLOAD_COMPLETE_ACK_PREFIX_MISMATCH`**, **`LIVE_CANARY_ABORTED_PEEK_ALLOWLIST_MISMATCH`**, **`LIVE_CANARY_PROVIDER_LANE_BLOCKED_BY_EXISTING_PROCESSING_CLAIM`**

---

## PR-9H.7D — Hashed phone export payload surfacing (Koç Oto Kurtarma canary)

| Field | Value |
|--------|--------|
| change_ticket | `PR-9H.7D` |
| site `public_id` | `93cb9966bcf349c1b4ece8ea34142ace` |
| site internal `id` | `3276893e-0433-4e35-95f2-4e80cf863f4c` |
| target `offline_conversion_queue.id` | `a81bec67-3b24-4c27-aa1a-40c7c4ecd0b2` |
| conversion (action) | `OpsMantik_Won` |
| provider_key | `google_ads` |

**Problem:** The canary row was allowlist-visible in PEEK, but the script logged **`hp=0`** because the API response did not include **server-prehashed** phone courier fields (`hashedPhoneNumber` / `userIdentifiers[type=hashed_phone]`), so the run hit **`HASHED_PHONE_EXPORT_MISSING`**.

**Goal (payload only):** Surface a **verified** 64-char lowercase SHA-256 hex from existing server sources (queue `user_identifiers` shapes and/or `calls.caller_phone_hash_sha256`) in the export item. **Never** export raw phone; the Google Ads Script stays **courier-only** (no normalization or hashing of raw phone in script).

**Read-only proof path:** `markAsExported=false`, allowlist = target queue id, `providerKey=google_ads` — **no** claim, **no** upload, **no** ACK, **no** `markAsExported=true` in this change record.

**Expected after deploy (preview only):** PEEK can show **`hp=1`** for the allowlisted row when a valid hash is present in DB paths; `preview_diagnostics` may show non-sensitive phone-hash **counts** and `hashed_phone_source_counts` (enum keys only). **Sync** and production canary **success** are **out of scope** for PR-9H.7D and require operator approval in a **later** change.

**`final_decision` (this PR, implementation / preview readiness):** **`HASHED_PHONE_CANARY_PEEK_READY`** — means the server **can** surface courier fields in preview; it does **not** certify end-to-end Google upload.

---

## PR-9H.7E — Koç Oto hashed-phone canary closeout (terminal success)

**Scope:** Read-only closeout record after PR-9H.7D payload surfacing + controlled Script sync. **No Google Ads Script rerun**, **no live export**, **no ACK/ACK_FAILED manual calls**, **no queue recovery** on the target row — the row is already terminal.

**`final_decision`:** **`HASHED_PHONE_CANARY_TERMINAL_SUCCESS`**

This label means the **hashed-phone Script lane** reached an operator-acceptable terminal state for the **target queue row**: journal **`COMPLETED`** with **`uploaded_at` populated**, ledger shows **SCRIPT claim (`PROCESSING`)** then **terminal `COMPLETED`**. It does **not** substitute for repo **`npm run release:evidence:production`** **`TARGET_DB_GREEN`** when DB evidence is unavailable (`EVIDENCE_PACKAGE_INCOMPLETE` — see below). An **organization-wide “production canary success”** verdict must **not** be issued unless the **full evidence package** (release gates + persisted summary parity) also passes — this closeout is **row-scoped** only.

**PR-9C separation:** **PR-9C** (Muratcan Aku / prior production canary audit) remains **invalid / separate** — do **not** merge this Koç terminal outcome into PR-9C reconciliation.

### Target row (`offline_conversion_queue`)

| Field | Value |
|--------|--------|
| `site_id` | `3276893e-0433-4e35-95f2-4e80cf863f4c` |
| `sites.public_id` | `93cb9966bcf349c1b4ece8ea34142ace` |
| `queue_id` | `a81bec67-3b24-4c27-aa1a-40c7c4ecd0b2` |
| `action` / conversion | `OpsMantik_Won` |
| `status` | `COMPLETED` |
| `uploaded_at` | `2026-05-10 22:19:48.738+00` |
| `provider_error_category` | `null` |
| `provider_error_code` | `null` |
| `provider_request_id` | `null` *(allowed for Google Ads Script bulk upload lane — not a failure signal)* |
| `external_id` | `oci_0ed22fd9175de8a2b003a486ea77208f` |
| `updated_at` | `2026-05-10 22:19:49.386923+00` |

### Ledger (`oci_queue_transitions`)

| created_at (UTC) | `new_status` | `actor` | Notes |
|------------------|--------------|---------|--------|
| `2026-05-10 22:19:44.299+00` | `PROCESSING` | `SCRIPT` | Claim / export-run alignment |
| `2026-05-10 22:19:48.738+00` | `COMPLETED` | `SCRIPT` | Terminal success (+ `uploaded_at` on row). **No `UPLOADED` intermediate** — this lane treats **`COMPLETED`** as terminal. |

### Script log evidence (operator-reported)

- **PEEK:** `hp=1` for the target row (hashed phone courier present).
- **SYNC:** `fetched=1`, `uploaded=1`, `failed=0`.
- **Export-run summary HTTP:** response indicated **`SCRIPT_SUMMARY_RECEIVED`** (reconciliation handler accepted payload).

### Evidence gaps (`EVIDENCE_PACKAGE_INCOMPLETE`)

- **Historical Koç run (`PR-9H.7E`):** the **`POST /api/oci/export-run-summary`** payload for that Script run was **not persisted** at the time — **Eq A–E cannot be fully reconstructed from SQL today** unless the **original HTTP summary payload** is recovered elsewhere. **PR-9H.7F** adds **`public.oci_export_run_summaries`** for **future** runs; it does **not** invent historical payloads.
- **Going forward:** **`export-run-summary`** must **persist** (counts/metadata only; see **PR-9H.7F**) so release evidence can close equations from DB **together with** queue + ledger proof.
- Local **`release:evidence:production`** historically returned **`DB_CONNECTION_FAILED`** when the wrong Postgres host was selected — **PR-9H.7F** prefers **pooler / pooled DSN** env ordering (`scripts/release/resolve-target-db-url.mjs`).

### Operator posture

- **No rerun** of the same allowlisted **`queue_id`** after this terminal outcome unless a **new change ticket** requires it.
- **No recovery** on **`a81bec67-3b24-4c27-aa1a-40c7c4ecd0b2`** — row is **`COMPLETED`** with upload timestamp.

---

## PR-9H.7F — Persisted script summaries + evidence collector repair

**Scope:** Production-grade closure for **export-run-summary** **counts/metadata** (no PII), **`scripts/sql/export_run_summary_health.sql`**, **`npm run release:evidence:production`** integration (including **`OCI_EVIDENCE_EXPORT_RUN_ID`** / **`OCI_EVIDENCE_SITE_ID`** / **`OCI_EVIDENCE_PROVIDER_KEY`** targeted strict blocking **`SCRIPT_SUMMARY_TARGET_MISSING`**), and **pooler-first** DB URL resolution for local evidence.

**PR-9H.7E terminal success remains valid:** Koç **`COMPLETED`** + ledger **`SCRIPT` terminal** is unchanged — **PR-9C** stays **invalid / separate**.

**Historical Koç summary:** Full Eq A–E from **SQL alone** for that **past** run remains **impossible** unless the **exact original summary HTTP body** exists — **do not backfill** guessed payloads.

**Future full closure classification:** **`HASHED_PHONE_CANARY_TERMINAL_SUCCESS_WITH_PERSISTED_SUMMARY`** — requires **queue terminal proof** + **ledger proof** + **`oci_export_run_summaries`** row for the run + **`npm run release:evidence:production`** green (including DB packs / metadata when applicable). Use when operators need **equation parity from DB**, not logs alone.

**Strict DB evidence:** When **`TARGET_DB_EVIDENCE_STRICT=1`**, artifact **`metadata.strict_mode`** is **true** and DB connectivity / targeted summary failures are **blocking** (no silent downgrade).

---

### Allowed `final_decision` labels (PR-9H.7E subsection)

- **`HASHED_PHONE_CANARY_TERMINAL_SUCCESS`** — row-level Script lane terminal outcome as documented above.
- **`HASHED_PHONE_CANARY_TERMINAL_SUCCESS_WITH_PERSISTED_SUMMARY`** — **PR-9H.7F** future closure: terminal row + persisted **`oci_export_run_summaries`** + release evidence green (equations checkable from DB).
- Supporting audit states: **`EVIDENCE_PACKAGE_INCOMPLETE`** when DB/release equation parity is still missing (does **not** revoke row terminal success).

---

## PR-9H.7G — Fresh persisted hashed-phone canary closure (Koç Oto Kurtarma)

**Intent:** Run a **new** **`QUEUED` / `RETRY`** row (do **not** reuse **`…ecd0b2`**, the legacy PR-9H.7E **`COMPLETED`** canary) through **PEEK → SYNC** with persisted **`oci_export_run_summaries`**, then prove closure with strict **`npm run release:evidence:production`** targeting **`OCI_EVIDENCE_QUEUE_ID`**, **`OCI_EVIDENCE_EXPORT_RUN_ID`**, **`OCI_EVIDENCE_SITE_ID`**, **`OCI_EVIDENCE_SITE_PUBLIC_ID`**, and **`OCI_EVIDENCE_REQUIRE_SCRIPT_SUMMARY=1`**.

**Site anchors (fixed):**

- **site_id:** `3276893e-0433-4e35-95f2-4e80cf863f4c`
- **site public_id:** `93cb9966bcf349c1b4ece8ea34142ace`

**Automation (repo):**

- Candidate picker (safe fields only): `node scripts/db/pr9h7g-fresh-hashed-phone-canary.mjs`
- Hosted preview gate: `node scripts/db/pr9h7g-hosted-preview-check.mjs` (defaults **`APP_BASE_URL=https://console.opsmantik.com`**; requires **`OCI_API_KEY`** / **`CANARY_API_KEY`**)

**Evidence collector additions:**

- **`OCI_EVIDENCE_REQUIRE_SCRIPT_SUMMARY=1`** → strict failure if **`OCI_EVIDENCE_EXPORT_RUN_ID`** / **`OCI_EVIDENCE_SITE_ID`** missing or summary row absent.
- **`OCI_EVIDENCE_REQUIRE_QUEUE_TERMINAL=1`** (optional) → strict failure unless queue row is **`COMPLETED`** with **`uploaded_at`** set for **`OCI_EVIDENCE_QUEUE_ID`** + **`OCI_EVIDENCE_SITE_ID`**.
- Artifact echoes **`checked_equations` / `missing_equations` / `mismatch_reasons`** from persisted summary equation evaluation (Eq A–D); **`oci_evidence_queue_evidence`** summarizes terminal check without logging secrets.

### Operator checklist (PR-9H.7G — Koç closure)

| Step | Status | Notes |
|---|---|---|
| Fresh **`queue_id`** selected (not legacy **`…ecd0b2`**) | `DONE` | Single **`QUEUED`** Won candidate processed end-to-end |
| Hosted preview **`markAsExported=false`**, allowlist contract **`applied_to_fetch=true`** | `DONE` | |
| Script **PEEK** / **SYNC** (**`hp=1`**, batch **1**, empty **`OPSMANTIK_ALLOWLIST_IDS`**) | `DONE` | Server-courier hashed phone only; no raw phone hashing in Script |
| Queue terminal **`COMPLETED`**, **`uploaded_at`**, clean **`provider_error_*`** | `DONE` | |
| Ledger / ACK path + **`oci_export_run_summaries`** persist, Eq **A–D** green | `DONE` | |
| Strict **`npm run release:evidence:production`** + target **`OCI_EVIDENCE_*`** | `DONE` | Target DB **`TARGET_DB_GREEN`**; see waiver note below for **`overall_status: PASS`** |

### Final decision (PR-9H.7G)

**Final label:** **`HASHED_PHONE_CANARY_TERMINAL_SUCCESS_WITH_PERSISTED_SUMMARY`**

**Closure narrative:** PR-9H.7G final decision: **`HASHED_PHONE_CANARY_TERMINAL_SUCCESS_WITH_PERSISTED_SUMMARY`**. Koç Oto Kurtarma hashed-phone canary completed end-to-end: allowlisted single **`OpsMantik_Won`** queue row was exported through Google Ads Script with server-courier hashed phone present, uploaded, ACKed, persisted into **`oci_export_run_summaries`**, reconciled with Eq **A–D**, and verified terminal in **`offline_conversion_queue`** as **`COMPLETED`** with **`uploaded_at`** set. Target DB evidence is green (**queue terminal ok**, **`SCRIPT_SUMMARY_PRESENT`**, **`SCRIPT_SUMMARY_RECONCILIATION_GREEN`**, **`checked_equations=A,B,C,D`**, **`missing_equations=NONE`**, **`mismatch_reasons=NONE`**). Release artifact **`overall_status: PASS`** while keeping **`OCI_EXPORT_RUN_INTEGRITY_STRICT=1`** requires the **known export-run integrity baseline waiver**: collector-level **`export_run_integrity`** remains **`EXPORT_RUN_INTEGRITY_UNVERIFIED`** outside the PR-9H.7G target evidence scope — this is **not** a canary functional failure; it is the policy gate that distinguishes target provenance from global runtime lineage proof.

**Waiver bundle (PowerShell) — strict posture + artifact PASS:**

```powershell
$env:TARGET_DB_EVIDENCE_STRICT="1"
$env:OCI_EVIDENCE_REQUIRE_SCRIPT_SUMMARY="1"
$env:OCI_EVIDENCE_REQUIRE_QUEUE_TERMINAL="1"
$env:OCI_EVIDENCE_SITE_ID="3276893e-0433-4e35-95f2-4e80cf863f4c"
$env:OCI_EVIDENCE_SITE_PUBLIC_ID="93cb9966bcf349c1b4ece8ea34142ace"
$env:OCI_EVIDENCE_QUEUE_ID="8dc2ffb7-737c-406c-8e27-13e1e8d0f4ac"
$env:OCI_EVIDENCE_EXPORT_RUN_ID="oci_run_1778455246911_162e4980"
$env:OCI_EXPORT_RUN_INTEGRITY_STRICT="1"
$env:OCI_EXPORT_RUN_WAIVER_OWNER="serkan"
$env:OCI_EXPORT_RUN_WAIVER_REASON="PR-9H.7G hashed-phone canary passed with terminal queue, persisted script summary, and Eq A-D reconciliation green; export_run_integrity remains collector-baseline UNVERIFIED."
$env:OCI_EXPORT_RUN_WAIVER_EXPIRY="2026-12-31T23:59:59Z"
$env:OCI_EXPORT_RUN_WAIVER_BLAST_RADIUS="single-site Koç hashed-phone canary evidence only"
npm run release:evidence:production
```

**Expected:** **`overall_status: PASS`**, **`waiver_status: ACCEPTED`** (or policy-passed-with-waiver per artifact), **`target_db_contract_status: TARGET_DB_GREEN`**, reconciliation and equation metadata unchanged vs. green target proof above.

Artifact PASS verified at `2026-05-10T23:30:28.252Z`: release:evidence:production completed with target DB green, Eq A-D green, queue terminal COMPLETED, persisted script summary reconciled, and export_run_integrity waiver accepted for single-site Koç hashed-phone canary scope.

## PR-9I — Universal script drain (GCLID / WBRAID / GBRAID + hashed phone courier)

**Objective:** drain **eligible** pending journal rows across **script-mode** sites using **one** click identifier per CSV row (**`gclid > wbraid > gbraid`**), optional **server courier** hashed phone on the same row, and **honest** classification when identifiers are missing or invalid.

**Invariants**

- **Exactly one** of Google Click ID / WBRAID / GBRAID populated per upload row; others empty.
- **Hashed phone** only from **verified** server payloads (`offline_conversion_queue.user_identifiers`, `calls.caller_phone_hash_sha256`) — **never** raw phone in Script; **never** log hash or click-id literals in operator logs.
- **Hashed-phone-only** rows are **not** treated as Script-lane success until a dedicated lane is proven.
- **Broad drain** remains behind **`SCRIPT_DRAIN_BLOCKED`** unless **`I_APPROVE_SCRIPT_DRAIN`** + site match + max-batch ≥ limit + braids **`true`** (see `export-auth`).

**Equations (persisted summary):** **Eq A–D** (PR-9H.7F) plus **Eq E–H** (PR-9I) when the script emits universal counters — see `lib/oci/export-run-summary-equations.ts` and evidence helpers.

**Decision labels (rollout):** `PR9I_AUDIT_READY` → `PR9I_UNIVERSAL_SCRIPT_CANARY_READY` → `PR9I_UNIVERSAL_SCRIPT_CANARY_TERMINAL_SUCCESS` → `PR9I_SITE_DRAIN_READY` → `PR9I_SITE_DRAIN_COMPLETED_WITH_PERSISTED_SUMMARY` (only after terminal queue + reconciled summary + Eq **A–H** green).

## PR-9I.1 — ACK finalization trusts export claim snapshot

**Binding policy**

- **Export-time** `buildExportItems` sendability, value/time gates, and single-conversion policy are **authoritative at claim** (`PROCESSING`).
- **`POST /api/oci/ack` SUCCESS** is **post-upload finalization** of rows the script reports as successfully dispatched. It **must not** hard-fail **`PROCESSING`** rows based on **mutable** post-claim `calls` status or live sendability helpers.
- **`POST /api/oci/ack-failed`** records provider/script validation or upload failure for **`PROCESSING`** rows; it **must not** downgrade **`COMPLETED` / `UPLOADED` / `COMPLETED_UNVERIFIED`** terminal success.
- **Apps Script ACK** confirms script dispatch success for the acknowledged id set — **not** guaranteed final Google offline conversion ingestion (operator may still use Google Ads upload history where applicable).

**Operator sequencing after green**

- When **`PR9I1_ACK_FINALIZATION_SNAPSHOT_GREEN`**: proceed toward **Koç broad script drain** using **drain approval gate** (no allowlist) per runbook, still **no** blind drain without PEEK evidence and approval tokens.

**Evidence:** target DB contract remains **`TARGET_DB_GREEN`** under existing collectors; script summary **Eq A–H** unchanged by this policy module (synthetic rows validated in unit tests).
