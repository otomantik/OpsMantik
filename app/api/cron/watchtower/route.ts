import { NextRequest, NextResponse } from 'next/server';
import { WatchtowerService } from '@/lib/services/watchtower';

export async function GET(req: NextRequest) {
    // 1. Authorization Check
    // Allow if CRON_SECRET is set and matches header, OR if running locally in dev (optional convenience)
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.CRON_SECRET;

    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
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
