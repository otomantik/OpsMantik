import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { logInfo, logError } from '@/lib/logging/logger';
import { INTENT_AUTO_JUNK_RETENTION_DAYS } from '@/lib/product/intent-retention';

/**
 * GET/POST /api/cron/auto-junk
 * Nightly Cron: Auto-Junk Stale Intent Leads (human-first retention)
 *
 * Target: status = 'intent' AND reviewed_at IS NULL AND expires_at < now()
 * (expires_at SSOT: insert trigger now + 90 days — see intent_retention_90d migration)
 *
 * Rows with panel review or stage/seal/junk stay off this path via status/reviewed_at.
 * Auth: requireCronAuth. Schedule: vercel.json "0 2 * * *"
 *
 * SAFETY: Site-scoped updates (max 500 sites per run).
 */
async function run() {
    try {
        const nowIso = new Date().toISOString();

        // Step 1: Collect distinct site_ids that have eligible rows — read-only, no mutation yet.
        const { data: eligibleSites, error: siteErr } = await adminClient
            .from('calls')
            .select('site_id')
            .eq('status', 'intent')
            .is('reviewed_at', null)
            .lt('expires_at', nowIso)
            .limit(500); // hard cap per run to bound blast radius

        if (siteErr) throw siteErr;

        const siteIds = [...new Set((eligibleSites ?? []).map((r: { site_id: string }) => r.site_id).filter(Boolean))];

        if (siteIds.length === 0) {
            logInfo('AUTO_JUNK_CRON_OK', {
                processed_count: 0,
                sites_affected: 0,
                retention_days: INTENT_AUTO_JUNK_RETENTION_DAYS,
            });
            return NextResponse.json({
                success: true,
                processed_count: 0,
                sites_affected: 0,
                retention_days: INTENT_AUTO_JUNK_RETENTION_DAYS,
                timestamp: nowIso,
            });
        }

        // Step 2: Update per site so each write is tenant-scoped and independently auditable.
        let totalCount = 0;
        const errors: string[] = [];

        for (const siteId of siteIds) {
            const { error, count } = await adminClient
                .from('calls')
                .update({ status: 'junk' })
                .eq('site_id', siteId)
                .eq('status', 'intent')
                .is('reviewed_at', null)
                .lt('expires_at', nowIso);

            if (error) {
                logError('AUTO_JUNK_SITE_FAILED', { site_id: siteId, error: error.message });
                errors.push(siteId);
            } else {
                totalCount += count ?? 0;
            }
        }

        logInfo('AUTO_JUNK_CRON_OK', {
            processed_count: totalCount,
            sites_affected: siteIds.length,
            sites_with_errors: errors.length,
            retention_days: INTENT_AUTO_JUNK_RETENTION_DAYS,
        });

        return NextResponse.json({
            success: errors.length === 0,
            processed_count: totalCount,
            sites_affected: siteIds.length,
            retention_days: INTENT_AUTO_JUNK_RETENTION_DAYS,
            sites_with_errors: errors.length > 0 ? errors : undefined,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        logError('AUTO_JUNK_CRON_FAILED', {
            error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;
    return run();
}

export async function POST(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;
    return run();
}
