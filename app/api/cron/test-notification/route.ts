import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { TelegramService } from '@/lib/services/telegram-service';

/**
 * Manual/cron test notification (Telegram). Not in vercel.json.
 * Auth: requireCronAuth (x-vercel-cron or Bearer CRON_SECRET) in all environments.
 */
export async function GET(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;

    try {
        const result = await TelegramService.sendMessage(
            '🔍 **OpsMantik Test Notification**\n\nThis is a manual test of the notification pipeline. If you see this, the Silent Scream fix is active.',
            'info'
        );

        return NextResponse.json({
            success: result,
            message: result ? 'Test message sent.' : 'Failed to send message. Check logs.'
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
