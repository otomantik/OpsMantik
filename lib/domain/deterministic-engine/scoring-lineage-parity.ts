/**
 * PR4-E — Scoring lineage parity (telemetry only): session V1.1 final score vs async brain score.
 * Pure classification + optional record helper; no persistence or formula changes.
 */

import { ENGINE_CONTRACT_VERSION } from '@/lib/domain/deterministic-engine/contract';
import { logDebug } from '@/lib/logging/logger';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

export type ScoringLineageParityOutcome = 'skipped' | 'match' | 'mismatch';

/** Shadow-only fields from processCallEvent → calc-brain-score QStash body. */
export type ShadowSessionQualityV1_1 = {
  final_score: number | null;
  confidence_score: number | null;
};

/**
 * Compare async brain score to match-time session quality V1.1 final score (same call).
 * Skips when session score is absent or non-finite, or brain score is non-finite.
 */
export function classifyScoringLineageParity(
  brainScore: number,
  sessionV11FinalScore: number | null
): ScoringLineageParityOutcome {
  if (sessionV11FinalScore == null || !Number.isFinite(sessionV11FinalScore)) {
    return 'skipped';
  }
  if (!Number.isFinite(brainScore)) {
    return 'skipped';
  }
  const b = Math.round(brainScore);
  const s = Math.round(sessionV11FinalScore);
  return b === s ? 'match' : 'mismatch';
}

/**
 * Increment parity metrics and log on mismatch only. No-op when consolidated flag is off.
 */
export function recordScoringLineageParityTelemetry(input: {
  consolidatedEnabled: boolean;
  brainScore: number;
  sessionV11FinalScore: number | null;
  siteId: string;
  callId: string;
}): void {
  if (!input.consolidatedEnabled) return;

  const outcome = classifyScoringLineageParity(input.brainScore, input.sessionV11FinalScore);
  if (outcome === 'skipped') {
    incrementRefactorMetric('truth_engine_scoring_lineage_parity_skipped_total');
    return;
  }

  incrementRefactorMetric('truth_engine_scoring_lineage_parity_check_total');
  if (outcome === 'match') {
    incrementRefactorMetric('truth_engine_scoring_lineage_parity_match_total');
    return;
  }

  incrementRefactorMetric('truth_engine_scoring_lineage_parity_mismatch_total');
  logDebug('ENGINE_CONSOLIDATED_SCORING_LINEAGE_PARITY_MISMATCH', {
    contract: ENGINE_CONTRACT_VERSION,
    site_id: input.siteId,
    call_id: input.callId,
    brain_score_rounded: Math.round(input.brainScore),
    session_v1_1_final_score_rounded: Math.round(input.sessionV11FinalScore as number),
  });
}
