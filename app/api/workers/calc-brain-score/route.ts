import { NextRequest, NextResponse } from 'next/server';
import { createTenantClient } from '@/lib/supabase/tenant-client';
import { calculateBrainScore } from '@/lib/ingest/scoring-engine';
import { insertCallScoreAudit } from '@/lib/scoring/call-scores-audit';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logError } from '@/lib/logging/logger';
import type { ScoreBreakdown } from '@/lib/types/call-event';

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
        const body = await req.json();
        const { site_id, call_id, payload, ads_context } = body;

        if (!site_id || !call_id) {
            return NextResponse.json({ error: 'Missing site_id or call_id' }, { status: 400 });
        }

        const tenantClient = createTenantClient(site_id);

        // 1. Calculate Score
        const { score: brainScore, breakdown: brainBreakdown } = calculateBrainScore(
            payload,
            ads_context
        );

        // 2. Logic: Fast-Track Routing
        const isFastTrack = brainScore >= 80;
        const finalStatus = isFastTrack ? 'qualified' : 'pending';

        // 3. Update Call Record (Optimistic Locking)
        // We fetch the current record to get the 'version' for concurrency control.
        const { data: callBefore, error: fetchErr } = await tenantClient
            .from('calls')
            .select('version, _client_value')
            .eq('id', call_id)
            .single();

        if (fetchErr || !callBefore) {
            logError('CALC_BRAIN_SCORE_CALL_NOT_FOUND', { site_id, call_id });
            return NextResponse.json({ error: 'Call not found' }, { status: 404 });
        }

        const currentVersion = callBefore.version ?? 0;

        const { data: updatedCall, error: updateError } = await tenantClient
            .from('calls')
            .update({
                lead_score: brainScore,
                lead_score_at_match: brainScore,
                score_breakdown: brainBreakdown,
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

        // 5. Fast-Track push to OCI (Idempotent via DB constraint)
        if (isFastTrack) {
            const { enqueueSealConversion } = await import('@/lib/oci/enqueue-seal-conversion');
            await enqueueSealConversion({
                callId: call_id,
                siteId: site_id,
                confirmedAt: new Date().toISOString(),
                saleAmount: updatedCall._client_value ?? null,
                currency: 'TRY',
                leadScore: brainScore,
            });
        }

        return NextResponse.json({ ok: true, score: brainScore, status: finalStatus }, { headers: getBuildInfoHeaders() });

    } catch (error) {
        logError('CALC_BRAIN_SCORE_FAILED', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
