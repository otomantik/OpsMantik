# OpsMantik Revenue OS: System Audit & Redesign Plan

This document serves as the implementation plan and deep system audit to transform OpsMantik into a production-grade "Revenue Operating System." The goal is to enforce a **SIMPLE USER / COMPLEX ENGINE** architecture where the frontend asks for minimal, high-signal data (outcome, bucket) and the backend handles all attribution, valuation, and exporting complexity.

> [!NOTE]
> This is a deep architectural audit of the existing Next.js, Supabase, and OCI pipeline.

## 1. Current State Analysis

### What's Correct & Production-Ready
- **Edge Ingestion & Isolation**: `app/api/sync` and `app/api/call-event` are highly defensively built. Rate limiting, Zod validation, anomaly detection, fail-closed Redis strategies, and QStash worker offloading are fundamentally solid.
- **Idempotency & Queuing**: The QStash async lanes and idempotency keys (`computeIdempotencyKey`) effectively deduplicate and ensure stability under load.
- **Session Attribution**: `findRecentSessionByFingerprint` with 14-day lookbacks and GCLID-preferring bridge logic correctly maps interactions to sessions.

### What's Over-Engineered & Unnecessary
- **Explicit Target & Stamp Tracking Constraints**: We are inferring `intent_action`, `intent_target`, and `intent_stamp` dynamically, but applying strict database-level constraints on them. This clutters the ingestion code with fallback logic to satisfy DB constraints instead of capturing the raw event.
- **Score Deconstruction**: The system over-indexes on complex `score_breakdown` arrays at the API layer when a simple dynamic threshold at the projection layer would suffice.

### What's Missing for a "Revenue OS"
- **Decoupled Value Projection**: The system currently skips conversion export when `saleAmount` is missing (`enqueue-seal-conversion.ts` lines 167-170). A true Revenue OS projects value dynamically even when exact revenue is unknown.
- **Abstracted "Interaction" Layer**: We treat "calls" differently than other conversion vectors. The system needs a unified "Interaction" layer that sits above channels.
- **Categorical Outcomes**: There is no standard state machine for what actually happened (UNREACHED, WON, etc.), just a proxy metric of "Call Sealed."

## 2. Critical Gaps

> [!WARNING]
> Blocking issues that violate the "simple input, complex processing" principle.

1. **Value Input Dependency (The Fatal Flaw)**:
   In `lib/oci/enqueue-seal-conversion.ts`, if `saleAmount` is null, the OCI export skips (`reason: 'no_sale_amount'`). Users do not always know the exact revenue immediately. Google Ads *needs* volume to train. Skipping exports because of a missing perfect value tanks campaign optimization.
2. **Scoring Reliability & Granularity**:
   Lead scoring is currently bound tightly to the ingestion phase. It should be re-evaluated continuously as new data (e.g. repeated interactions) flows in.
3. **Export Correctness**:
   We are not sending lower-confidence (but still valid) pipeline stages to Google Ads. We should be sending `QUALIFIED` or `LOW` bucket interactions as micro-conversions to feed the algorithm, rather than exclusively bottlenecking at a "purchase" stage.
4. **Deduplication Risks**:
   The unique index logic is spread across Redis replay caches, idempotency keys, and DB unique indices based on provider keys. This needs to be consolidated around the *Outcome*, not just the raw event.

## 3. Universal Outcome Model Design

To support ALL industries, we must implement a standard Enum for Outcomes and separate the monetary value into categorical buckets.

### Outcome Enum
Mapped to the `interactions` (or `calls` for now) table via an `outcome_status` column.
- **`UNREACHED`**: Pinged, but no actual connection. (Not exported)
- **`INVALID`**: Spam, wrong number, automated bot. (Used for negative scoring/fraud)
- **`INFO_ONLY`**: Valid prospect, but just asking questions. (Exported as low-value goal if repeated)
- **`QUALIFIED`**: Verified fit, actionable lead. (Export: Primary Lead)
- **`APPOINTMENT`**: Next step scheduled. (Export: High-value Lead)
- **`WON`**: Converted/Bought. (Export: Purchase)
- **`LOST`**: Qualified but dropped out. (Not exported / exported as secondary)

### Value Bucket Enum
Mapped via a `value_bucket` column.
- **`LOW`**: Marginally useful interaction.
- **`MEDIUM`**: Standard deal size.
- **`HIGH`**: Premium deal size.
- **`VERY_HIGH`**: Outlier/Whale.

**Storage**: These drop into the current `calls` table (which should be renamed/refactored towards `interactions`), driving the `offline_conversion_queue`. `sale_amount` becomes purely optional.

## 4. Data Flow Redesign (CRITICAL)

**FROM (Current):**
`event` (sync/call-event) → `session` (attribution) → `call` (table) → `scoring` → `queue` (Seal) → `export` (OCI)
*(Hard dependency on exact value at the queue/seal step).*

**TO (New Architecture):**
`event` → `session` → `interaction` → `outcome` → `value model` → `projection` → `export`

1. **Event & Session**: Unchanged. `app/api/sync` stays edge-optimized.
2. **Interaction**: Generalizes `calls`, `forms`, `whatsapp`.
3. **Outcome**: The Frontend only sets `outcome` (e.g. WON) and `value_bucket` (e.g. MEDIUM).
4. **Value Model**: A backend service `lib/valuation/model.ts` reads the bucket, the industry default AOV, and confidence variables to generate a `projected_value_cents`.
5. **Projection**: The computed value is written to the `offline_conversion_queue`.
6. **Export**: OCI sync runs based on the projection, ensuring high signal volume.

## 5. Value Model Strategy

> [!TIP]
> Exact Revenue is strictly OPTIONAL.

If the user provides an exact value, the model uses it with 100% confidence. If not, the engine handles it seamlessly:

1. **Bucket-Based Valuation**: 
   - `LOW` = 0.25x Industry Default
   - `MEDIUM` = 1.0x Industry Default
   - `HIGH` = 3.0x Industry Default
   - `VERY_HIGH` = 10.0x Industry Default
2. **Default Value per Industry**: Fetched from `sites.default_aov` or an industry-level config.
3. **Confidence Scoring**: 
   - Known value = 1.0 confidence.
   - Profile-matched value (e.g. known repeat caller) = 0.8.
   - Blind bucket prediction = 0.5.
4. **Predicted vs Confirmed**: The OCI queue exports `projected_value_cents`. A later reconciliation job can patch Google Ads if the offline value is updated later (via Google Ads Value Adjustments or Conversion Restatement).

## 6. Export Logic (Google Ads)

Rules for `offline_conversion_queue` export:

**Do NOT export when:**
- Outcome is `UNREACHED`, `INVALID`, or `LOST` (unless specifically tracking lost leads for negative bidding, but hold off for phase 1).
- Call duration < 15 seconds AND no explicit `outcome` was selected by the user.

**Export as CONFIRMED (Purchase):**
- Outcome is `WON` with a computed/projected value > 0.
- Outcome is `APPOINTMENT` (depending on site conversion config).

**Export as LOW Confidence (Micro-Conversion / Qualified Lead):**
- Outcome is `QUALIFIED` or `INFO_ONLY` (if call duration > 60s). Sent as a secondary conversion action in Google Ads to feed the algorithm volume without skewing ROAS.

## 7. Simplification Plan

### REMOVE
- `enqueue-seal-conversion.ts` requirement for `saleAmount`. Null values must fall back to the Value Model.
- Hardcoded `intent_action` constraints that cause ingestion errors in edge cases.
- Over-bloated Frontend "Seal" modal complexity. It should be 3 clicks max: "Outcome -> Bucket -> Done".

### KEEP
- QStash async boundaries (`/api/workers/ingest`).
- Strict UUID resolution and rate limiting at Edge.
- Current table structures (`sessions`, `offline_conversion_queue`), utilizing `jsonb` or adding columns as needed for migrations.

### REFACTOR
- Refactor `enqueueSealConversion` to invoke a `projectConversionValue(site, bucket, outcome)` service.
- Rename client-facing "Calls" concepts to "Interactions" in the model mapping.
- Move OCI filtering logic entirely backend. The UI should *never* prevent a seal because of "missing data"; it just saves the outcome, and the backend decides if it's OCI-worthy.

## 8. Final Architecture

### Core APIs
1. `/api/sync`: Universal edge ingestion for all telemetry.
2. `/api/interactions`: Unified endpoint combining calls, whatsapp, and forms.
3. `/api/engine/outcome`: The single endpoint the UI hits. Payload: `{ interaction_id, outcome, value_bucket, exact_value? }`.

### Core Tables (Target State)
1. `sessions`: Standard tracking context, GCLID.
2. `interactions` (formerly calls): Source, target, duration, `outcome`, `value_bucket`.
3. `offline_conversion_queue`: `status`, `projected_value_cents`, `conversion_action` (Purchase vs Qualified).

### Core Invariants
- **Backend Sovereignty**: The UI never decides if an event goes to Google Ads.
- **Continuous Volume**: If a user interacted meaningfully (QUALIFIED, APPOINTMENT, WON), it MUST reach Google Ads, even if we have to make an educated guess at the value.
- **Fail-Open Ingestion, Fail-Closed Export**: Accept raw messy data instantly at the edge. Rigorously validate and score it async before it ever touches `offline_conversion_queue`.

---

## User Review Required
Please review the proposed Data Flow Redesign and Universal Outcome Enum. If you approve this target architecture, I will proceed with creating the `task.md` checklist to implement these steps.
