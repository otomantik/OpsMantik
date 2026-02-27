import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { logInfo, logError } from '@/lib/logging/logger';

/**
 * Nightly Cron: Auto-Junk Stale Leads
 * Target: status = 'pending' AND expires_at < now()
 * Auth: requireCronAuth (x-vercel-cron or Bearer CRON_SECRET). Schedule: vercel.json "0 2 * * *"
 */
async function handler() {
    try {
        const nowIso = new Date().toISOString();
        const { error, count } = await adminClient
            .from('calls')
            .update({ status: 'junk' })
            .eq('status', 'pending')
            .lt('expires_at', nowIso);

        if (error) throw error;

        logInfo('AUTO_JUNK_CRON_OK', { processed_count: count ?? 0 });

        return NextResponse.json({
            success: true,
            processed_count: count ?? 0,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logError('AUTO_JUNK_CRON_FAILED', {
            error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;
    return handler();
}
