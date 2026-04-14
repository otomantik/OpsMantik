/**
 * Phase 3 — Shadow inference run registry (truth_inference_runs).
 * Gated by TRUTH_INFERENCE_REGISTRY_ENABLED; failures never break ingest.
 */

import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { OPSMANTIK_VERSION } from '@/lib/version';
import { stableInferenceDigest } from '@/lib/domain/truth/inference-digest';

const PG_UNIQUE_VIOLATION = '23505';

export type InferenceRunKind = 'SYNC_ATTRIBUTION_V1' | 'CALL_EVENT_SESSION_MATCH_V1';

export interface RecordInferenceRunInput {
  siteId: string;
  inferenceKind: InferenceRunKind;
  policyVersion: string;
  /** Structural input fingerprint (already hashed or use stableInferenceDigest upstream). */
  inputDigest: string;
  outputSummary: Record<string, unknown>;
  idempotencyKey: string;
  occurredAt: Date;
  correlationId?: string | null;
  dedupEventId?: string | null;
  sessionId?: string | null;
  callId?: string | null;
}

export async function recordInferenceRun(input: RecordInferenceRunInput): Promise<{ recorded: boolean }> {
  if (!getRefactorFlags().truth_inference_registry_enabled) {
    return { recorded: false };
  }

  const {
    siteId,
    inferenceKind,
    policyVersion,
    inputDigest,
    outputSummary,
    idempotencyKey,
    occurredAt,
    correlationId,
    dedupEventId,
    sessionId,
    callId,
  } = input;

  const { error } = await adminClient.from('truth_inference_runs').insert({
    site_id: siteId,
    inference_kind: inferenceKind,
    policy_version: policyVersion,
    engine_version: OPSMANTIK_VERSION,
    input_digest: inputDigest,
    output_summary: outputSummary,
    idempotency_key: idempotencyKey,
    correlation_id: correlationId ?? null,
    dedup_event_id: dedupEventId ?? null,
    session_id: sessionId ?? null,
    call_id: callId ?? null,
    occurred_at: occurredAt.toISOString(),
  });

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { recorded: false };
    }
    logWarn('recordInferenceRun failed', {
      siteId,
      idempotencyKey,
      inferenceKind,
      error: error.message,
    });
    throw error;
  }

  incrementRefactorMetric('truth_inference_registry_probe_total');
  return { recorded: true };
}

export async function recordInferenceRunBestEffort(input: RecordInferenceRunInput): Promise<void> {
  try {
    await recordInferenceRun(input);
  } catch {
    /* best-effort */
  }
}

/** Digest inputs for sync attribution path (no raw URL/fingerprint). */
export function digestSyncAttributionInputs(input: {
  siteId: string;
  dedupEventId: string;
  hasCurrentGclid: boolean;
  fingerprintPresent: boolean;
}): string {
  return stableInferenceDigest({
    kind: 'sync_attribution_v1',
    site_id: input.siteId,
    dedup_event_id: input.dedupEventId,
    has_current_gclid: input.hasCurrentGclid,
    fingerprint_present: input.fingerprintPresent,
  });
}

/** Digest for call-event session match (no raw fingerprint). */
export function digestCallEventMatchInputs(input: {
  siteId: string;
  fingerprintLength: number;
  hasPayloadClickIds: boolean;
}): string {
  return stableInferenceDigest({
    kind: 'call_event_session_match_v1',
    site_id: input.siteId,
    fingerprint_length: input.fingerprintLength,
    has_payload_click_ids: input.hasPayloadClickIds,
  });
}
