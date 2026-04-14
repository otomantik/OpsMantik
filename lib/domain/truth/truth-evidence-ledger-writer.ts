/**
 * Append-only shadow writes to truth_evidence_ledger (Phase 1+).
 * Gated by TRUTH_SHADOW_WRITE_ENABLED; failures must never break ingest.
 * Phase 2: TRUTH_TYPED_EVIDENCE_ENABLED validates v2 envelope into payload (shadow validation).
 */

import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import {
  resolveTruthEvidencePayload,
  type TruthEvidenceKind,
  type TruthIngestSource,
} from '@/lib/domain/truth/truth-evidence-envelope';

export type { TruthEvidenceKind, TruthIngestSource };

const PG_UNIQUE_VIOLATION = '23505';

export interface AppendTruthEvidenceInput {
  siteId: string;
  evidenceKind: TruthEvidenceKind;
  ingestSource: TruthIngestSource;
  idempotencyKey: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
  sessionId?: string | null;
  callId?: string | null;
  correlationId?: string | null;
}

/**
 * When shadow writes are disabled, returns immediately (no DB).
 * Idempotent: duplicate (site_id, idempotency_key) → { appended: false }.
 */
export async function appendTruthEvidenceLedger(input: AppendTruthEvidenceInput): Promise<{ appended: boolean }> {
  if (!getRefactorFlags().truth_shadow_write_enabled) {
    return { appended: false };
  }

  incrementRefactorMetric('truth_shadow_write_attempt_total');

  const flags = getRefactorFlags();
  const resolved = resolveTruthEvidencePayload({
    evidenceKind: input.evidenceKind,
    ingestSource: input.ingestSource,
    correlationId: input.correlationId ?? null,
    occurredAt: input.occurredAt,
    legacyPayload: input.payload,
    typedEvidenceEnabled: flags.truth_typed_evidence_enabled,
  });

  if (flags.truth_typed_evidence_enabled && !resolved.typedEnvelopeOk) {
    incrementRefactorMetric('truth_typed_evidence_validation_fail_total');
  }

  const {
    siteId,
    evidenceKind,
    ingestSource,
    idempotencyKey,
    occurredAt,
    sessionId,
    callId,
    correlationId,
  } = input;

  const { error } = await adminClient.from('truth_evidence_ledger').insert({
    site_id: siteId,
    evidence_kind: evidenceKind,
    ingest_source: ingestSource,
    idempotency_key: idempotencyKey,
    occurred_at: occurredAt.toISOString(),
    session_id: sessionId ?? null,
    call_id: callId ?? null,
    correlation_id: correlationId ?? null,
    payload: resolved.payload,
    schema_version: resolved.schema_version,
  });

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { appended: false };
    }
    logWarn('appendTruthEvidenceLedger failed', {
      siteId,
      idempotencyKey,
      evidenceKind,
      error: error.message,
    });
    throw error;
  }

  if (resolved.typedEnvelopeOk && resolved.schema_version === 'phase2') {
    incrementRefactorMetric('truth_typed_evidence_shadow_total');
  }

  return { appended: true };
}

/**
 * Best-effort shadow append (never throws). Use after successful main-path work.
 */
export async function appendTruthEvidenceLedgerBestEffort(input: AppendTruthEvidenceInput): Promise<void> {
  try {
    await appendTruthEvidenceLedger(input);
  } catch {
    /* best-effort */
  }
}
