import { adminClient } from '@/lib/supabase/admin';
import { TelegramService } from './telegram-service';
import { logError, logWarn } from '@/lib/logging/logger';

function sanitizePii(text: string): string {
    // Best-effort sanitization for outbound webhooks.
    // The current Watchtower payload is non-PII, but we fail-safe for future additions.
    return String(text || '')
        // Emails
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
        // Phone-like sequences (very loose)
        .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
        // Bearer tokens
        .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, 'Bearer [redacted]');
}

function getWebhookConfig(): { url: string; kind: 'slack' | 'generic' } {
    const url = (process.env.ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || '').trim();
    const kindEnv = (process.env.ALERT_WEBHOOK_KIND || '').trim().toLowerCase();
    const kind = (kindEnv === 'slack' || url.includes('hooks.slack.com')) ? 'slack' : 'generic';
    return { url, kind };
}

async function sendAlertWebhook(args: { level: 'alarm' | 'warning' | 'info'; message: string; health: WatchtowerHealth }): Promise<boolean> {
    const { url, kind } = getWebhookConfig();
    if (!url) return false;

    const timeoutMs = Math.max(500, Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS || 5000));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const safeMessage = sanitizePii(args.message);
    const payload =
        kind === 'slack'
            ? { text: safeMessage }
            : {
                service: 'watchtower',
                level: args.level,
                message: safeMessage,
                health: args.health, // current health payload is non-PII (counts/status/env)
              };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            logError('alert webhook failed', { status: res.status, body: txt.slice(0, 500), kind });
            return false;
        }
        return true;
    } catch (err) {
        clearTimeout(timeoutId);
        logError('alert webhook error', { error: String((err as Error)?.message ?? err), kind });
        return false;
    }
}

export interface WatchtowerHealth {
    status: 'ok' | 'alarm';
    checks: {
        sessionsLastHour: {
            status: 'ok' | 'alarm';
            count: number;
        };
        gclidLast3Hours: {
            status: 'ok' | 'alarm';
            count: number;
        };
    };
    details: {
        timestamp: string;
        environment: string;
    };
}

export class WatchtowerService {
    /**
     * Checks if any new sessions have been created in the last hour.
     * "Dead Man's Switch" for session ingestion.
     */
    static async checkSessionVitality(): Promise<number> {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        // Using adminClient to bypass RLS and ensure we see all data
        const { count, error } = await adminClient
            .from('sessions')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', oneHourAgo);

        if (error) {
            console.error('[WATCHTOWER] Session vitality check failed:', error);
            throw error;
        }

        return count ?? 0;
    }

    /**
     * Checks if any GCLID (Google Click ID) records have been ingested in the last 3 hours.
     * "Dead Man's Switch" for ad attribution.
     */
    static async checkAttributionLiveness(): Promise<number> {
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

        const { count, error } = await adminClient
            .from('sessions')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', threeHoursAgo)
            .not('gclid', 'is', null);

        if (error) {
            console.error('[WATCHTOWER] Attribution liveness check failed:', error);
            throw error;
        }

        return count ?? 0;
    }

    /**
     * Runs all health checks and returns a summary.
     * Triggers notifications (logging) if alarms are active.
     */
    static async runDiagnostics(): Promise<WatchtowerHealth> {
        try {
            const sessionsCount = await this.checkSessionVitality();
            const gclidCount = await this.checkAttributionLiveness();

            const sessionStatus = sessionsCount > 0 ? 'ok' : 'alarm';
            const gclidStatus = gclidCount > 0 ? 'ok' : 'alarm';

            const overallStatus = (sessionStatus === 'ok' && gclidStatus === 'ok') ? 'ok' : 'alarm';

            const healthCheck: WatchtowerHealth = {
                status: overallStatus,
                checks: {
                    sessionsLastHour: {
                        status: sessionStatus,
                        count: sessionsCount
                    },
                    gclidLast3Hours: {
                        status: gclidStatus,
                        count: gclidCount
                    }
                },
                details: {
                    timestamp: new Date().toISOString(),
                    environment: process.env.NODE_ENV || 'development'
                }
            };

            if (overallStatus === 'alarm') {
                // Fire-and-forget, but notify() is fail-closed (never throws).
                void this.notify(healthCheck);
            }

            return healthCheck;

        } catch (error) {
            console.error('[WATCHTOWER] Critical failure running diagnostics:', error);
            // Fail open but loud
            return {
                status: 'alarm',
                checks: {
                    sessionsLastHour: { status: 'alarm', count: -1 },
                    gclidLast3Hours: { status: 'alarm', count: -1 }
                },
                details: {
                    timestamp: new Date().toISOString(),
                    environment: process.env.NODE_ENV || 'development'
                }
            };
        }
    }

    /**
     * Dispatch alerts.
     * Logs to console and sends Telegram notification for critical alarms.
     */
    private static async notify(health: WatchtowerHealth) {
        try {
            const issues: string[] = [];
            if (health.checks.sessionsLastHour.status === 'alarm') {
                issues.push(`- 📉 **ZERO Traffic:** No sessions recorded in last 1 hour.`);
            }
            if (health.checks.gclidLast3Hours.status === 'alarm') {
                issues.push(`- 💸 **Ads Blindness:** No GCLID (ad click) recorded in last 3 hours.`);
            }

            const alertMessage = `
**WATCHTOWER DETECTED PIPELINE STALL**

Environment: \`${health.details.environment}\`
Time: ${health.details.timestamp}

**Detected Issues:**
${issues.join('\n')}

**Diagnostics:**
- Sessions (1h): ${health.checks.sessionsLastHour.count}
- GCLIDs (3h): ${health.checks.gclidLast3Hours.count}

_Immediate investigation required._
        `.trim();

            // 1) Structured log (fail-closed: never throws, but logs loudly)
            logError('watchtower alarm', { health });

            // 2) Deliver notifications concurrently; never block Telegram on webhook latency.
            const webhookP = sendAlertWebhook({ level: 'alarm', message: alertMessage, health });
            const telegramP = TelegramService.sendMessage(alertMessage, 'alarm');
            const [webhookRes, telegramRes] = await Promise.allSettled([webhookP, telegramP]);

            if (webhookRes.status === 'fulfilled' && webhookRes.value === false) {
                logWarn('watchtower webhook not delivered', { environment: health.details.environment });
            } else if (webhookRes.status === 'rejected') {
                logWarn('watchtower webhook threw', { environment: health.details.environment });
            }

            if (telegramRes.status === 'fulfilled' && telegramRes.value === false) {
                logWarn('watchtower telegram not delivered', { environment: health.details.environment });
            } else if (telegramRes.status === 'rejected') {
                logWarn('watchtower telegram threw', { environment: health.details.environment });
            }
        } catch (err) {
            // Never throw from notify — avoid unhandled rejections and keep endpoint stable.
            logError('watchtower notify failed', { error: String((err as Error)?.message ?? err) });
        }
    }
}
