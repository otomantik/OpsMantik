/**
 * Best-effort insert into call_scores audit table. Fail-open: log error, do not throw.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logWarn } from '@/lib/logging/logger';

export interface CallScoresAuditParams {
  siteId: string;
  callId: string;
  scoreBreakdown: Record<string, unknown>;
}

/**
 * Insert one row into call_scores if breakdown has V1.1 shape. Does not throw.
 */
export async function insertCallScoreAudit(
  client: SupabaseClient,
  params: CallScoresAuditParams,
  meta?: { request_id?: string; route?: string }
): Promise<void> {
  const { siteId, callId, scoreBreakdown } = params;
  if (scoreBreakdown.version !== 'v1.1' || !scoreBreakdown.inputsSnapshot) {
    return;
  }
  const snap = scoreBreakdown.inputsSnapshot as Record<string, unknown>;
  const qualityScore = Number(scoreBreakdown.finalScore);
  const confidenceScore =
    typeof scoreBreakdown.confidenceScore === 'number' ? scoreBreakdown.confidenceScore : null;
  const conversionPoints = Number(scoreBreakdown.conversionPoints) || 0;
  const interactionPoints = Number(scoreBreakdown.interactionPoints) || 0;
  const bonuses = Number(scoreBreakdown.bonuses) || 0;
  const bonusesCapped = Number(scoreBreakdown.bonusesCapped) ?? Number(scoreBreakdown.bonuses) ?? 0;
  const rawScore = Number(scoreBreakdown.rawScore) || 0;
  const cappedAt100 = Boolean(scoreBreakdown.cappedAt100);

  const { error } = await client.from('call_scores').insert({
    site_id: siteId,
    call_id: callId,
    score_version: 'v1.1',
    quality_score: qualityScore,
    confidence_score: confidenceScore,
    conversion_points: conversionPoints,
    interaction_points: interactionPoints,
    bonuses,
    bonuses_capped: bonusesCapped,
    penalties: 0,
    raw_score: rawScore,
    capped_at_100: cappedAt100,
    inputs_snapshot: snap,
  });

  if (error) {
    logWarn('call_scores_audit_insert_failed', {
      ...meta,
      site_id: siteId,
      call_id: callId,
      error: error.message,
      code: error.code,
    });
  }
}
