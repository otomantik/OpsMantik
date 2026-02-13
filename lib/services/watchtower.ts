import { adminClient } from '@/lib/supabase/admin';
import { TelegramService } from './telegram-service';

export type WatchtowerStatus = 'ok' | 'degraded' | 'alarm' | 'critical';

export interface WatchtowerHealth {
    status: WatchtowerStatus;
    checks: {
        sessionsLastHour: {
            status: 'ok' | 'alarm';
            count: number;
        };
        gclidLast3Hours: {
            status: 'ok' | 'alarm';
            count: number;
        };
        ingestPublishFailuresLast15m: {
            status: 'ok' | 'degraded' | 'critical' | 'unknown';
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
     * Count of ingest_publish_failures in the last 15 minutes (QStash publish failures from /api/sync).
     * Returns -1 on error (DB/query failure) so caller can set status "unknown" — we do not report 0 when we couldn't check.
     */
    static async checkIngestPublishFailuresLast15m(): Promise<number> {
        const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { count, error } = await adminClient
            .from('ingest_publish_failures')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', fifteenMinAgo);

        if (error) {
            console.error('[WATCHTOWER] Ingest publish failures check failed:', error);
            return -1;
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
            const [sessionsCount, gclidCount, failureCount] = await Promise.all([
                this.checkSessionVitality(),
                this.checkAttributionLiveness(),
                this.checkIngestPublishFailuresLast15m(),
            ]);

            const sessionStatus = sessionsCount > 0 ? 'ok' : 'alarm';
            const gclidStatus = gclidCount > 0 ? 'ok' : 'alarm';
            const ingestFailureStatus: 'ok' | 'degraded' | 'critical' | 'unknown' =
                failureCount === -1 ? 'unknown' : failureCount === 0 ? 'ok' : failureCount > 5 ? 'critical' : 'degraded';

            let overallStatus: WatchtowerStatus =
                sessionStatus === 'ok' && gclidStatus === 'ok' ? 'ok' : 'alarm';
            if (failureCount > 5) overallStatus = 'critical';
            else if (failureCount > 0) overallStatus = overallStatus === 'ok' ? 'degraded' : overallStatus;
            else if (failureCount === -1) overallStatus = overallStatus === 'ok' ? 'degraded' : overallStatus;

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
                    },
                    ingestPublishFailuresLast15m: {
                        status: ingestFailureStatus,
                        count: failureCount
                    }
                },
                details: {
                    timestamp: new Date().toISOString(),
                    environment: process.env.NODE_ENV || 'development'
                }
            };

            if (overallStatus === 'alarm') {
                this.notify(healthCheck);
            }

            return healthCheck;

        } catch (error) {
            console.error('[WATCHTOWER] Critical failure running diagnostics:', error);
            // Fail open but loud
            return {
                status: 'alarm',
                checks: {
                    sessionsLastHour: { status: 'alarm', count: -1 },
                    gclidLast3Hours: { status: 'alarm', count: -1 },
                    ingestPublishFailuresLast15m: { status: 'unknown', count: -1 }
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

        // 1. Log to console for Sentry/Logs
        console.error('[WATCHTOWER] ALARM STATE:', JSON.stringify(health, null, 2));

        // 2. Send Telegram Notification
        await TelegramService.sendMessage(alertMessage, 'alarm');
    }
}
