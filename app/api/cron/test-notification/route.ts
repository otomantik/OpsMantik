
import { NextRequest, NextResponse } from 'next/server';
import { TelegramService } from '@/lib/services/telegram-service';

// Security check
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
    const authHeader = req.headers.get('authorization');

    if (process.env.NODE_ENV === 'production') {
        if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
            return new NextResponse('Unauthorized', { status: 401 });
        }
    }

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
