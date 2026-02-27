import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireQstashSignature } from '@/lib/qstash/require-signature';
import { logError } from '@/lib/logging/logger';

/**
 * Nightly Cron: Auto-Junk Stale Leads
 * Target: status = 'pending' AND expires_at < now()
 */
async function handler() {
    try {
        // 1. Identify and transition stale leads
        const { error, count } = await adminClient
            .from('calls')
            // eventIdColumnOk is checked in the loop
            .update({
                status: 'junk',
            })
            .eq('status', 'pending')
            .lt('expires_at', new Date().toISOString());

        if (error) throw error;

        console.log(`[AUTO-JUNK CRON] Successfully processed ${count || 0} stale leads.`);

        return NextResponse.json({
            success: true,
            processed_count: count || 0,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logError('AUTO_JUNK_CRON_FAILED', {
            error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// Secure with QStash signature
export const POST = requireQstashSignature(handler);
