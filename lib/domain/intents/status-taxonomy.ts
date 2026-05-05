/**
 * Calls `calls.status` — inventory SSOT referenced by parity tests and `/status` route literals.
 *
 * Authoritative narratives + columns: `docs/OPS/INTENT_RUNTIME_PARITY_MATRIX.md` (taxonomy table).
 * DB CHECK constraint: `supabase/migrations/20260508120000_panel_oci_schema_safety_net.sql`.
 * OCI outbox precursor mapping: `resolveOciStageFromCallStatus` in `lib/oci/enqueue-panel-stage-outbox.ts`.
 * Panel funnel stages: `lib/oci/optimization-contract.ts`, `lib/domain/mizan-mantik/types.ts` (`PipelineStage`).
 */

/** Values allowed by Postgres `calls_status_check` (NULL also allowed). */
export const CANONICAL_DB_CALL_STATUSES = [
  'intent',
  'contacted',
  'offered',
  'won',
  'confirmed',
  'junk',
  'cancelled',
  'qualified',
  'real',
  'suspicious',
] as const;

/** Primary English funnel + lifecycle states set via `apply_call_action_v2` / ingest. */
export const CANONICAL_CALL_STATUSES = [
  'intent',
  'contacted',
  'offered',
  'won',
  'confirmed',
  'junk',
  'cancelled',
] as const;

/** Ads-qualified ladder / UI legacy labels still stored on `calls` (DB CHECK incl.). */
export const LEGACY_CALL_STATUSES = ['qualified', 'real', 'suspicious'] as const;

/**
 * Migration/SQL + defensive lifecycle token **`merged`** (not a stored `calls.status` CHECK value).
 * Operational merge/archive is represented by **`calls.merged_into_call_id`**; never rely on
 * `calls.status = 'merged'` unless a future migration adds it to `calls_status_check`.
 */
export const MIGRATION_AND_APP_SURFACE_STATUSES = ['merged'] as const;

/**
 * Same tuple as **`TERMINAL_STATUSES`** in `lib/intents/session-reuse-v1.ts`: burst session reuse
 * rejects these with **`terminal_status`** (includes **`won`** sealed rows).
 *
 * Distinct from OCI “won-tier” / Google conversion mapping (`OCI_GOOGLE_CONVERSION_WON_TIER_*`).
 */
export const TERMINAL_CALL_STATUSES = ['won', 'confirmed', 'junk', 'cancelled'] as const;

/**
 * Persisted statuses that map to a non-null OCI pipeline stage via
 * `resolveOciStageFromCallStatus` (precursor enqueue / conversion ladder; excludes `intent`/etc.).
 */
export const OCI_EXPORTABLE_CALL_STATUSES = [
  'contacted',
  'offered',
  'junk',
  'won',
  'confirmed',
  'qualified',
  'real',
] as const;

/** Alias (remediation naming): persisted `calls.status` producing a non-null OCI precursor stage. */
export const OCI_EXPORTABLE_STAGE_STATUSES = OCI_EXPORTABLE_CALL_STATUSES;

/**
 * Persisted statuses whose OCI precursor resolves to **`won`**-tier Google offline conversions.
 * Still subject to export gates (`merged_into_call_id`, click eligibility, guards).
 */
export const OCI_GOOGLE_CONVERSION_WON_TIER_CALL_STATUSES = [
  'won',
  'confirmed',
  'qualified',
  'real',
] as const;

/** POST `/api/intents/[id]/status` body — executable subset (`lib/api/intent-status-route-contract.ts`). */
export const STATUS_ROUTE_EXECUTABLE_STATUSES = ['junk', 'cancelled', 'intent'] as const;

/**
 * Full `{ status }` recognition order on `/status` route (frozen; clients/tests may depend).
 * Executable ∪ unsupported recognized = this tuple.
 */
export const INTENT_POST_STATUS_ROUTE_RECOGNIZED_ORDERED = [
  'confirmed',
  'qualified',
  'real',
  'junk',
  'suspicious',
  'cancelled',
  'intent',
] as const;

/** Recognized-but-unsupported subset for the same endpoint. */
export const STATUS_ROUTE_UNSUPPORTED_RECOGNIZED_STATUSES = [
  'confirmed',
  'qualified',
  'real',
  'suspicious',
] as const;

/** Sorted union surfaced in taxonomy documentation + parity tests — every row in markdown table. */
export const DOCUMENTED_CALL_STATUS_INVENTORY_SORTED: readonly string[] = [
  ...new Set([
    ...(CANONICAL_DB_CALL_STATUSES as readonly string[]),
    ...(MIGRATION_AND_APP_SURFACE_STATUSES as readonly string[]),
  ]),
].sort((a, b) => a.localeCompare(b));

function asSet<T extends readonly string[]>(arr: T): ReadonlySet<string> {
  return new Set(arr);
}

export const CANONICAL_DB_CALL_STATUS_SET = asSet(CANONICAL_DB_CALL_STATUSES);

export const CANONICAL_CALL_STATUS_SET = asSet(CANONICAL_CALL_STATUSES);

export const LEGACY_CALL_STATUS_SET = asSet(LEGACY_CALL_STATUSES);

export const TERMINAL_CALL_STATUS_SET = asSet(TERMINAL_CALL_STATUSES);

export const OCI_EXPORTABLE_CALL_STATUS_SET = asSet(OCI_EXPORTABLE_CALL_STATUSES);

export const OCI_GOOGLE_CONVERSION_WON_TIER_STATUS_SET = asSet(OCI_GOOGLE_CONVERSION_WON_TIER_CALL_STATUSES);

export const STATUS_ROUTE_EXECUTABLE_STATUS_SET = asSet(STATUS_ROUTE_EXECUTABLE_STATUSES);

export const INTENT_POST_BODY_RECOGNIZED_SET = asSet(INTENT_POST_STATUS_ROUTE_RECOGNIZED_ORDERED);
