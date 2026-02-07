
/**
 * Telegram Notification Service
 * Sends critical alerts to a designated Telegram chat.
 */

export type AlertLevel = 'info' | 'warning' | 'alarm';

export class TelegramService {
    private static getApiUrl(token: string) {
        return `https://api.telegram.org/bot${token}/sendMessage`;
    }

    static async sendMessage(message: string, level: AlertLevel = 'info'): Promise<boolean> {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;

        // Silent fail in dev if not configured, but log it
        if (!token || !chatId) {
            if (process.env.NODE_ENV === 'production') {
                console.error('[TELEGRAM] CRITICAL: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in production!');
            } else {
                console.warn('[TELEGRAM] Missing env vars, skipping notification.');
            }
            return false;
        }

        const prefix = {
            info: 'ℹ️ *[INFO]*',
            warning: '⚠️ *[WARNING]*',
            alarm: '🚨 *[CRITICAL ALARM]*'
        }[level];

        // Combine prefix with message, ensuring message is string
        const text = `${prefix}\n\n${message}`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

            const res = await fetch(this.getApiUrl(token), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: text,
                    parse_mode: 'Markdown', // Allows bold/italic
                    disable_web_page_preview: true
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                const errText = await res.text();
                console.error(`[TELEGRAM] Failed to send message (${res.status}):`, errText);
                return false;
            }

            return true;
        } catch (err) {
            console.error('[TELEGRAM] Network error:', err);
            return false;
        }
    }
}
