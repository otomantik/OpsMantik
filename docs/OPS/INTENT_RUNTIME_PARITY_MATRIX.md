# Intent Runtime Parity Matrix

This file is the runtime contract inventory for intent visibility and ingest continuity.
It compares:

- what runtime code calls
- what exists in active `supabase/migrations`
- what exists in canonical `schema.sql`

## Scope

- Ingest gates and compensation
- Quota/reconciliation surfaces
- Intent read/write RPC surfaces
- Funnel ledger write surface

## Contract Matrix

| Surface | Runtime code reference | Active migrations (`supabase/migrations`) | Canonical (`schema.sql`) | Status |
|---|---|---|---|---|
| `public.increment_usage_checked(uuid,date,text,int)` | `lib/ingest/sync-gates.ts` | Missing | Present | Gap (critical) |
| `public.decrement_and_delete_idempotency(...)` | `lib/ingest/execute-ingest-command.ts` | Missing | Missing in current canonical snapshot | Gap (critical) |
| `public.site_plans` | `lib/quota.ts` | Missing | Present | Gap (critical) |
| `public.site_usage_monthly` | `lib/quota.ts`, `lib/reconciliation.ts` | Missing | Present | Gap (critical) |
| `public.usage_counters` | implicit via `increment_usage_checked` | Missing | Present | Gap (critical) |
| `public.call_funnel_ledger` | `lib/domain/funnel-kernel/ledger-writer.ts`, `app/api/metrics/route.ts` | Missing | Missing in current canonical snapshot | Gap (critical) |
| `public.get_recent_intents_lite_v1(...)` | queue/dashboard APIs | Present (`00000000000007_runtime_recovery_rpcs.sql`) | Present | OK (verify behavior) |
| `public.get_dashboard_intents(...)` | `lib/hooks/use-site-config.ts` + dashboard flow | Present (`00000000000007_runtime_recovery_rpcs.sql`) | Present | OK (verify behavior) |
| `public.get_intent_details_v1(...)` | intent detail page/API | Present (`00000000000007_runtime_recovery_rpcs.sql`) | Present | OK |
| `public.get_activity_feed_v1(...)` | activity views/APIs | Present (`00000000000007_runtime_recovery_rpcs.sql`) | Present | OK |

## Call `status` taxonomy — SSOT (docs + tests)

Frozen literals for parity tests live in **`lib/domain/intents/status-taxonomy.ts`**. Markdown rows **must stay in sync** with `DOCUMENTED_CALL_STATUS_INVENTORY_SORTED` (`tests/unit/status-taxonomy-contract.test.ts`).

**Merged archival reality:** canonical merge/archive is **`calls.merged_into_call_id`**, not `calls.status`. **`merged`** appears as a defensive string in burst/dedupe SQL (`20261118120000_burst_cross_session_dedupe_cleanup_v1.sql`) and as **`ARCHIVAL_STATUSES`** telemetry in `lib/intents/session-reuse-v1.ts`, but **`merged` is not** in current `calls_status_check` — do **not** persist `calls.status = 'merged'` unless a future migration enumerates it.

Definitions used below:

| Term | Meaning |
|---|---|
| Canonical | Primary funnel + lifecycle statuses (`CANONICAL_CALL_STATUSES`). |
| Legacy | Ads-qualified ladder persisted on rows (`LEGACY_CALL_STATUSES`). |
| Terminal | **`TERMINAL_CALL_STATUSES`** — mirrors **`TERMINAL_STATUSES`** in `session-reuse-v1.ts` (blocks burst reuse with `terminal_status`; includes **`won`**). Independent of OCI enqueue gating. |
| OCI precursor | **`resolveOciStageFromCallStatus`** (`enqueue-panel-stage-outbox.ts`): maps persisted status → **`contacted` / `offered` / `won` / `junk` / null** (null ⇒ no precursor stage envelope from this helper). |

<!-- intent-status-taxonomy-ssot-begin -->

| Status | Canonical / legacy / surface | DB `calls_status_check` | Emitted (`call.status` JSON) | `POST …/status` body | `POST …/stage` | `POST …/seal` | Terminal (`TERMINAL_CALL_STATUSES`)? | OCI precursor (non-null)? | Maps to Google conversion tier | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| `intent` | Canonical | Yes | Yes | **Executable** restore → RPC `contacted` | Via score/action → **`contacted`** / **`junk`** (not `intent` literal on RPC) | **No** literal field — applies **`won`** | No | No (`null`) | No | Router/queue ingest default. |
| `contacted` | Canonical | Yes | Yes | Invalid / use stage route | **Yes** (OptimizationStage funnel) | No | No | **`contacted`** | Indirect (`contacted`-tier jobs) | `apply_call_action_v2` stage set. |
| `offered` | Canonical | Yes | Yes | Invalid | **Yes** | No | No | **`offered`** | Indirect (`offered`-tier jobs) | |
| `won` | Canonical | Yes | Yes | Invalid | **Yes** (`action_type`/score ⇒ `won`) | **Seal applies `won`** | **Yes** (session reuse) | **`won`** | **Won-tier** (`OpsMantik_Won`, etc.; gated) | Sealed sale + reuse terminal; same label drives Google won-tier precursor. |
| `confirmed` | Canonical (sealed sale adjacency) | Yes | Yes | **Unsupported recognized** (`UNSUPPORTED_STATUS`) | Score ladder may lift toward `won`; not a body label | Typical post-seal read shape | Yes | **`won`** (precursor treats as won-tier) | **Won-tier** | Often paired historically with confirmations. |
| `junk` | Canonical | Yes | Yes | **Executable** | **Yes** | No | Yes | **`junk`** | Junk / terminalization rails | Negative disposition. |
| `cancelled` | Canonical (`calls` enum) | Yes | Yes | **Executable** (**alias → persists `junk`**) | No direct label | No | Yes | **`null`** (resolver) — row often junk-equivalent thereafter | Normally **No** once terminalized | **`/status` compat:** body `cancelled` maps RPC stage **`junk`**. |
| `qualified` | Legacy (Ads ladder) | Yes | Yes | **Unsupported recognized** | Indirect via score/action only | No | No | **`won`** (precursor lumps with won-tier) | **Won-tier** precursor path | Derived historically from scoring/async surfaces. |
| `real` | Legacy (Ads ladder) | Yes | Yes | **Unsupported recognized** | Indirect via score/action | No | No | **`won`** (won-tier precursor) | **Won-tier** | |
| `suspicious` | Legacy / risk label | Yes | Yes | **Unsupported recognized** | Indirect patterns only | No | No | **`null`** | No precursor lift | Visible in dashboards; keep until taxonomy migration. |
| `merged` | **Surface / SQL token** (**not CHECK**) | **No** | **N/A** — use **`merged_into_call_id`** | No | No | No | N/A (use **`merged_into_call_id`**) | **`merged_into_call_id`** skips outbox (**metric `merged`**) — not a resolver stage | Skipped while merged | **`calls.status='merged'` is not DB-valid today**; runtime paths gate on **`merged_into_call_id`**. |

<!-- intent-status-taxonomy-ssot-end -->

## Intent status API contract (`POST /api/intents/[id]/status`)

Source of truth: `lib/api/intent-status-route-contract.ts` (applied in `app/api/intents/[id]/status/route.ts`).

Inputs are normalized (trimmed, lowercased) before routing.

### Accepted (executable via this endpoint)

Maps to **`apply_call_action_with_review_v1`** / `apply_call_action_v2` as follows:

| Body `status` | RPC `p_stage` | `reviewed` flags | Persisted disposition note |
|---|---|---|---|
| `junk` | `junk` | Reviewed (`reviewed_*` stamped) | `calls.status → junk` |
| `cancelled` | **`junk`** | Reviewed | **Legacy alias:** persists **`junk`** (same disposition as Junk; not DB `cancelled`) |
| `intent` | `contacted` | Clears reviewed (`restore` path) | Re-opens queue card as contacted |

Terminal / export semantics are unchanged elsewhere (OCI envelope); this table is only mutation capability.

### Rejected explicitly (HTTP 400, after auth unless `INVALID_STATUS`)

- **`UNSUPPORTED_STATUS`** — recognized funnel / seal labels **not implemented on this endpoint**:
  `confirmed`, `qualified`, `real`, `suspicious`  
  Use **`POST /api/intents/[id]/stage`** (scored actions + funnel) or **`POST /api/calls/[id]/seal`** (won/confirmation lineage).
- **`INVALID_STATUS`** — missing/empty bodies, arbitrary strings (`won`, `offered`, `contacted`, etc.).

Structured error body shape:

```json
{ "ok": false, "code": "UNSUPPORTED_STATUS" | "INVALID_STATUS", "status": "<normalized>|null", "reason": "…" }
```

No silent coercion into `intent` for unsupported payloads.

### Client expectation

Treat `UNSUPPORTED_STATUS` as “call the correct surface”; treat `INVALID_STATUS` as programmer error / stale UI. Preserve `cancelled` → `junk` persistence when migrating clients gradually.

## Behavior Risk Notes

1. `sync` can return accepted while downstream still fails.  
   Queue acceptance is not proof of `processed_signals -> events -> calls` writes.

2. Queue visibility is fail-closed in `get_recent_intents_lite_v1`.  
   If one row in the same `matched_session_id` is `junk/cancelled`, pending rows are hidden.

3. Compensation path currently calls an RPC that does not exist in active migrations.  
   This creates a retry/idempotency inconsistency risk on worker failures.

4. Quota path currently calls an RPC and tables that do not exist in active migrations.  
   This can short-circuit worker gates and suppress intent writes.

## Immediate Repair Order

1. `site_plans`, `site_usage_monthly`, `usage_counters`
2. `increment_usage_checked(...)`
3. `decrement_and_delete_idempotency(...)`
4. `call_funnel_ledger` (DDL + indexes + grants)
5. Re-verify `get_recent_intents_lite_v1` visibility semantics with live data

## Verification Queries (post-migration)

```sql
-- Function existence
select to_regprocedure('public.increment_usage_checked(uuid,date,text,integer)');
select to_regprocedure('public.decrement_and_delete_idempotency(uuid,date,text,text)');

-- Table existence
select to_regclass('public.site_plans');
select to_regclass('public.site_usage_monthly');
select to_regclass('public.usage_counters');
select to_regclass('public.call_funnel_ledger');
```
