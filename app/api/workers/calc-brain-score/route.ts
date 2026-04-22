import { NextRequest, NextResponse } from 'next/server';
import { createTenantClient } from '@/lib/supabase/tenant-client';
import { calculateBrainScore } from '@/lib/ingest/scoring-engine';
import { insertCallScoreAudit } from '@/lib/scoring/call-scores-audit';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logError } from '@/lib/logging/logger';
import type { ScoreBreakdown } from '@/lib/types/call-event';
import {
  recordScoringLineageParityTelemetry,
  type ShadowSessionQualityV1_1,
} from '@/lib/domain/deterministic-engine/scoring-lineage-parity';
import { getRefactorFlags } from '@/lib/refactor/flags';
import {
  OPTIMIZATION_MODEL_VERSION,
  buildOptimizationSnapshot,
  clampSystemScore,
  resolveOptimizationStage,
} from '@/lib/oci/optimization-contract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/workers/calc-brain-score
 * Decoupled worker to calculate brain score and update lead status.
 * Triggered by QStash after call ingestion.
 */
export async function POST(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;

    try {
        const bodyUnknown = await req.json().catch(() => ({}));
        const body =
            bodyUnknown && typeof bodyUnknown === 'object' && !Array.isArray(bodyUnknown)
                ? (bodyUnknown as Record<string, unknown>)
                : {};
        const site_id = typeof body.site_id === 'string' ? body.site_id : '';
        const call_id = typeof body.call_id === 'string' ? body.call_id : '';
        const payload = body.payload;
        const ads_context = body.ads_context;
        const shadow_session_quality_v1_1 = body.shadow_session_quality_v1_1;

        if (!site_id || !call_id) {
            return NextResponse.json({ error: 'Missing site_id or call_id' }, { status: 400 });
        }

        const tenantClient = createTenantClient(site_id);

        const payloadObj =
            payload && typeof payload === 'object' && !Array.isArray(payload)
                ? (payload as Record<string, unknown>)
                : {};
        const scoringPayload = {
            ua: typeof payloadObj.ua === 'string' ? payloadObj.ua : null,
            intent_action: typeof payloadObj.intent_action === 'string' ? payloadObj.intent_action : 'phone',
        };
        const adsContext =
            ads_context && typeof ads_context === 'object' && !Array.isArray(ads_context)
                ? ads_context
                : null;

        // 1. Calculate Score
        const { score: brainScore, breakdown: brainBreakdown } = calculateBrainScore(
            scoringPayload,
            adsContext
        );
        const systemScore = clampSystemScore(brainScore);

        const shadow = shadow_session_quality_v1_1 as ShadowSessionQualityV1_1 | undefined;
        const shadowFinal =
            shadow != null &&
            typeof shadow.final_score === 'number' &&
            Number.isFinite(shadow.final_score)
                ? shadow.final_score
                : null;

        recordScoringLineageParityTelemetry({
            consolidatedEnabled: getRefactorFlags().truth_engine_consolidated_enabled,
            brainScore,
            sessionV11FinalScore: shadowFinal,
            siteId: site_id,
            callId: call_id,
        });

        // 2. Canonical stage prediction from system score (prediction only, not export authority)
        const predictedStage = resolveOptimizationStage({ leadScore: systemScore });
        const optimizationSnapshot = buildOptimizationSnapshot({
            stage: predictedStage,
            systemScore,
            modelVersion: OPTIMIZATION_MODEL_VERSION,
        });
        const isFastTrack = predictedStage === 'offered' || predictedStage === 'won';

        // 3. Update Call Record (Optimistic Locking)
        // We fetch the current record to get the 'version' for concurrency control.
        const { data: callBefore, error: fetchErr } = await tenantClient
            .from('calls')
            .select('version, status')
            .eq('id', call_id)
            .single();

        if (fetchErr || !callBefore) {
            logError('CALC_BRAIN_SCORE_CALL_NOT_FOUND', { site_id, call_id });
            return NextResponse.json({ error: 'Call not found' }, { status: 404 });
        }

        const currentVersion = callBefore.version ?? 0;
        const currentStatus = (callBefore as { status?: string | null }).status ?? null;
        const finalStatus =
            currentStatus === 'confirmed' ||
            currentStatus === 'real' ||
            currentStatus === 'junk' ||
            currentStatus === 'suspicious' ||
            currentStatus === 'cancelled'
                ? currentStatus
                : 'intent';

        const { data: updatedCall, error: updateError } = await tenantClient
            .from('calls')
            .update({
                lead_score: systemScore,
                lead_score_at_match: systemScore,
                system_score: systemScore,
                score_breakdown: brainBreakdown,
                model_version: OPTIMIZATION_MODEL_VERSION,
                optimization_stage: optimizationSnapshot.optimizationStage,
                quality_factor: optimizationSnapshot.qualityFactor,
                optimization_value: optimizationSnapshot.optimizationValue,
                status: finalStatus,
                is_fast_tracked: isFastTrack,
                version: currentVersion + 1,
                updated_at: new Date().toISOString(), // Still using JS Date for updated_at, but expires_at is DB-level
            })
            .eq('id', call_id)
            .eq('version', currentVersion)
            .select()
            .single();

        if (updateError) {
            // If error is 0 rows or constraint, it's a conflict
            logError('CALC_BRAIN_SCORE_CONFLICT', { message: updateError.message, site_id, call_id });
            return NextResponse.json({ error: 'Concurrency conflict' }, { status: 409 });
        }

        // 4. Audit Log (V1.1 parity)
        if (brainBreakdown && (brainBreakdown as unknown as ScoreBreakdown | null)?.version === 'v1.1') {
            await insertCallScoreAudit(tenantClient, {
                siteId: site_id,
                callId: call_id,
                scoreBreakdown: brainBreakdown,
            }, { route: 'calc-brain-score' });
        }

        return NextResponse.json({
            ok: true,
            score: systemScore,
            system_score: systemScore,
            optimization_stage: optimizationSnapshot.optimizationStage,
            score_breakdown: brainBreakdown,
            model_version: OPTIMIZATION_MODEL_VERSION,
            status: finalStatus,
        }, { headers: getBuildInfoHeaders() });

    } catch (error) {
        logError('CALC_BRAIN_SCORE_FAILED', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
