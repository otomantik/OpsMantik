import { NextRequest, NextResponse } from 'next/server';
import { WatchtowerService } from '@/lib/services/watchtower';

export const runtime = 'nodejs'; // Force Node.js runtime for stability

export async function GET(req: NextRequest) {
    // 1. Authorization Check (Fail-Closed Architecture)
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';

    // Critical Security: In production, if CRON_SECRET is missing, 
    // we must FAIL SAFE (500) rather than allowing public access.
    if (isProduction && !cronSecret) {
        console.error('[WATCHTOWER] CRITICAL SECURITY CONFIG ERROR: CRON_SECRET missing in production.');
        return new NextResponse('Internal Server Config Error: Secure CRON setup required.', { status: 500 });
    }

    // Standard bearer token check
    // If running logically (with secret present), check it.
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    // 2. Execute Health Checks
    try {
        const health = await WatchtowerService.runDiagnostics();

        // 3. Log Alarm if detected (Service already logs error, but we can add meta-logging here)
        if (health.status === 'alarm') {
            console.error('[WATCHTOWER] CRON DETECTED ALARM STATE');
        }

        return NextResponse.json(health);
    } catch (error) {
        console.error('[WATCHTOWER] Cron execution failed:', error);
        return NextResponse.json(
            {
                status: 'error',
                message: 'Watchtower execution failed',
                details: error instanceof Error ? error.message : String(error)
            },
            { status: 500 }
        );
    }
}
