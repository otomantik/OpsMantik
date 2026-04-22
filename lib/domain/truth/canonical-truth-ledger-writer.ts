/**
 * Append-only shadow writes to truth_canonical_ledger (PR3).
 * Gated by TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED; failures must never break ingest.
 *
 * Payload: flexible jsonb at rest; callers must follow the canonical payload contract
 * (small refs + class enums — no raw PII, no upstream metadata dumps). See append sites in ingest + funnel.
 *
 * Metrics: duplicate unique violations (23505) count as success, not failure.
 */

import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { recordTruthParityMismatch } from '@/lib/domain/truth/truth-parity';

const PG_UNIQUE_VIOLATION = '23505';

export type CanonicalStreamKind = 'INGEST_SYNC' | 'INGEST_CALL_EVENT' | 'FUNNEL_LEDGER';

export type AppendCanonicalTruthInput = {
  siteId: string;
  streamKind: CanonicalStreamKind;
  idempotencyKey: string;
  occurredAt: Date;
  sessionId?: string | null;
  callId?: string | null;
  correlationId?: string | null;
  payload: Record<string, unknown>;
  schemaVersion?: string;
};

/**
 * Non-null insert errors only. `duplicate` → success metric (idempotent replay); `other` → failure metric.
 * Exported for unit tests documenting PR3 duplicate-as-success semantics.
 */
export function classifyCanonicalLedgerInsertError(error: { code?: string }): 'duplicate' | 'other' {
  return error.code === PG_UNIQUE_VIOLATION ? 'duplicate' : 'other';
}

/**
 * When shadow writes are disabled, returns immediately (no DB, no metrics).
 * Idempotent: duplicate (site_id, idempotency_key) → { appended: false }; metrics still record success (see below).
 *
 * Success metric: incremented on new row OR on 23505 (duplicate = successful idempotent replay).
 * Failure metric: only non-23505 insert errors.
 */
export async function appendCanonicalTruthLedger(input: AppendCanonicalTruthInput): Promise<{ appended: boolean }> {
  if (!getRefactorFlags().truth_canonical_ledger_shadow_enabled) {
    return { appended: false };
  }

  incrementRefactorMetric('truth_canonical_ledger_attempt_total');

  const {
    siteId,
    streamKind,
    idempotencyKey,
    occurredAt,
    sessionId,
    callId,
    correlationId,
    payload,
    schemaVersion = 'canonical_v1',
  } = input;

  const { error } = await adminClient.from('truth_canonical_ledger').insert({
    site_id: siteId,
    stream_kind: streamKind,
    idempotency_key: idempotencyKey,
    occurred_at: occurredAt.toISOString(),
    session_id: sessionId ?? null,
    call_id: callId ?? null,
    correlation_id: correlationId ?? null,
    payload,
    schema_version: schemaVersion,
  });

  if (error) {
    if (classifyCanonicalLedgerInsertError(error) === 'duplicate') {
      incrementRefactorMetric('truth_canonical_ledger_success_total');
      return { appended: false };
    }
    incrementRefactorMetric('truth_canonical_ledger_failure_total');
    logWarn('appendCanonicalTruthLedger failed', {
      siteId,
      idempotencyKey,
      streamKind,
      error: error.message,
    });
    throw error;
  }

  incrementRefactorMetric('truth_canonical_ledger_success_total');
  return { appended: true };
}

export async function appendCanonicalTruthLedgerBestEffort(input: AppendCanonicalTruthInput): Promise<void> {
  try {
    await appendCanonicalTruthLedger(input);
  } catch (error) {
    incrementRefactorMetric('truth_canonical_ledger_failure_total');
    const mode = getRefactorFlags().truth_parity_mode;
    if (mode === 'detect' || mode === 'enforce') {
      await recordTruthParityMismatch({
        siteId: input.siteId,
        streamKind: input.streamKind,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    logWarn('appendCanonicalTruthLedgerBestEffort failed', {
      siteId: input.siteId,
      streamKind: input.streamKind,
      idempotencyKey: input.idempotencyKey,
      error: error instanceof Error ? error.message : String(error),
    });
    if (mode === 'enforce') {
      throw error;
    }
  }
}

export async function appendCanonicalTruthLedgerFailClosed(input: AppendCanonicalTruthInput): Promise<{ appended: boolean }> {
  return appendCanonicalTruthLedger(input);
}
