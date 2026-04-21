/**
 * Strict DB row interfaces for OCI runner queries.
 *
 * Eliminates `as { ... }` casts by defining the exact shape of every
 * Supabase query result used in the runner pipeline. If a column is
 * renamed in a migration, TypeScript will surface the mismatch at
 * compile time instead of silently returning `undefined`.
 *
 * These interfaces are intentionally narrow — they contain ONLY the
 * columns selected in each specific query, not the full table schema.
 */

// ── list_offline_conversion_groups RPC ──────────────────────────────

/** Return row from `list_offline_conversion_groups` RPC. */
export interface ConversionGroupRow {
  site_id: string;
  provider_key: string;
  queued_count: number;
  min_next_retry_at: string | null;
  min_created_at: string;
}

// ── get_provider_health_state RPC ───────────────────────────────────

/** Return row from `get_provider_health_state` RPC. */
export interface ProviderHealthRow {
  state: string;
  next_probe_at: string | null;
  probe_limit: number;
}

// ── provider_credentials query ──────────────────────────────────────

/** Row from `provider_credentials` table (encrypted_payload only). */
export interface ProviderCredentialsRow {
  encrypted_payload: string;
}

// ── calls phone hash query ──────────────────────────────────────────

/** Row from `calls` table for Enhanced Conversions phone hash enrichment. */
export interface CallPhoneHashRow {
  id: string;
  caller_phone_hash_sha256: string | null;
}

// ── provider_upload_attempts insert payloads ────────────────────────

/** Shape for provider_upload_attempts STARTED phase insert. */
export interface UploadAttemptStartedInsert {
  site_id: string;
  provider_key: string;
  batch_id: string;
  phase: 'STARTED';
  claimed_count: number;
}

/** Shape for provider_upload_attempts FINISHED phase insert. */
export interface UploadAttemptFinishedInsert {
  site_id: string;
  provider_key: string;
  batch_id: string;
  phase: 'FINISHED';
  claimed_count: number;
  completed_count: number;
  failed_count: number;
  retry_count: number;
  duration_ms: number;
  provider_request_id?: string | null;
  error_code?: string | null;
  error_category?: string | null;
}

// ── Shared batch processing types ───────────────────────────────────

/** Input for the shared `processConversionBatch` function. */
export interface ConversionBatchInput {
  siteId: string;
  providerKey: string;
  rows: import('@/lib/cron/process-offline-conversions').QueueRow[];
  credentials: unknown;
  prefix: string;
  /** If true, skip value-mismatch rows instead of processing them. */
  failClosedOnMismatch: boolean;
}

/** Outcome counters from `processConversionBatch`. */
export interface ConversionBatchResult {
  completed: number;
  failed: number;
  retry: number;
  /** IDs of rows blocked by value or poison-pill policies. */
  blockedIds: string[];
  /** IDs of rows that were poison pills. */
  poisonIds: string[];
}
