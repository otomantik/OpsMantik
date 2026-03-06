import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';
import { TelegramService } from './telegram-service';

export type WatchtowerStatus = 'ok' | 'degraded' | 'alarm' | 'critical';

export interface WatchtowerHealth {
    status: WatchtowerStatus;
    checks: {
        sessionsLastHour: {
            status: 'ok' | 'alarm' | 'unknown';
            count: number;
        };
        gclidLast3Hours: {
            status: 'ok' | 'alarm' | 'unknown';
            count: number;
        };
        ingestPublishFailuresLast15m: {
            status: 'ok' | 'degraded' | 'critical' | 'unknown';
            count: number;
        };
        /** PR-4: sites with reconciliation drift_pct > 1% in last 1h */
        billingReconciliationDriftLast1h: {
            status: 'ok' | 'degraded';
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

        const { count, error } = await adminClient
            .from('sessions')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', oneHourAgo);

        if (error) {
            logError('WATCHTOWER_session_vitality_failed', { error: error.message });
            return -1; // unknown — do not conflate DB failure with zero traffic
        }

        return count ?? 0;
    }

    /**
     * PR-4: Count of sites with reconciliation drift > 1% in last 1h (from billing_reconciliation_jobs last_drift_pct).
     */
    static async checkBillingReconciliationDriftLast1h(): Promise<number> {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data, error } = await adminClient
            .from('billing_reconciliation_jobs')
            .select('site_id')
            .eq('status', 'COMPLETED')
            .gte('updated_at', oneHourAgo)
            .gt('last_drift_pct', 0.01);

        if (error) {
            logError('WATCHTOWER_billing_drift_check_failed', { error: error.message });
            return -1;
        }
        const siteIds = new Set((data ?? []).map((r: { site_id?: string }) => r.site_id).filter(Boolean));
        return siteIds.size;
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
            logError('WATCHTOWER_ingest_failures_check_failed', { error: error.message });
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
            logError('WATCHTOWER_attribution_liveness_failed', { error: error.message });
            return -1; // unknown — do not conflate DB failure with ads blindness
        }

        return count ?? 0;
    }

    /**
     * Runs all health checks and returns a summary.
     * Triggers notifications (logging) if alarms are active.
     */
    static async runDiagnostics(): Promise<WatchtowerHealth> {
        try {
            const [sessionsCount, gclidCount, failureCount, driftCount] = await Promise.all([
                this.checkSessionVitality(),
                this.checkAttributionLiveness(),
                this.checkIngestPublishFailuresLast15m(),
                this.checkBillingReconciliationDriftLast1h(),
            ]);

            // -1 means DB query failed — treat as unknown (degraded), not alarm.
            // Conflating a DB failure with zero traffic would fire false-positive pages.
            const sessionStatus: 'ok' | 'alarm' | 'unknown' = sessionsCount === -1 ? 'unknown' : sessionsCount > 0 ? 'ok' : 'alarm';
            const gclidStatus: 'ok' | 'alarm' | 'unknown' = gclidCount === -1 ? 'unknown' : gclidCount > 0 ? 'ok' : 'alarm';
            const ingestFailureStatus: 'ok' | 'degraded' | 'critical' | 'unknown' =
                failureCount === -1 ? 'unknown' : failureCount === 0 ? 'ok' : failureCount > 5 ? 'critical' : 'degraded';
            const driftStatus: 'ok' | 'degraded' =
                driftCount === -1 ? 'ok' : driftCount > 0 ? 'degraded' : 'ok';

            let overallStatus: WatchtowerStatus =
                sessionStatus === 'alarm' || gclidStatus === 'alarm'
                    ? 'alarm'
                    : sessionStatus === 'unknown' || gclidStatus === 'unknown'
                        ? 'degraded'
                        : 'ok';
            if (failureCount > 5) overallStatus = 'critical';
            else if (failureCount > 0) overallStatus = overallStatus === 'ok' ? 'degraded' : overallStatus;
            else if (failureCount === -1) overallStatus = overallStatus === 'ok' ? 'degraded' : overallStatus;
            if (driftCount > 0 && overallStatus === 'ok') overallStatus = 'degraded';

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
                    },
                    billingReconciliationDriftLast1h: {
                        status: driftStatus,
                        count: driftCount === -1 ? 0 : driftCount
                    }
                },
                details: {
                    timestamp: new Date().toISOString(),
                    environment: process.env.NODE_ENV || 'development'
                }
            };

            if (this.shouldNotify(overallStatus)) {
                await this.notify(healthCheck);
            }

            return healthCheck;

        } catch (error) {
            logError('WATCHTOWER_diagnostics_failed', { error: error instanceof Error ? error.message : String(error) });
            // Fail open but loud
            return {
                status: 'degraded',
                checks: {
                    sessionsLastHour: { status: 'unknown', count: -1 },
                    gclidLast3Hours: { status: 'unknown', count: -1 },
                    ingestPublishFailuresLast15m: { status: 'unknown', count: -1 },
                    billingReconciliationDriftLast1h: { status: 'ok', count: 0 }
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
     * Logs to console and sends Telegram notification for degraded/alarm/critical states.
     */
    private static shouldNotify(status: WatchtowerStatus): boolean {
        return status === 'degraded' || status === 'alarm' || status === 'critical';
    }

    private static async notify(health: WatchtowerHealth) {
        const issues: string[] = [];
        if (health.checks.sessionsLastHour.status === 'alarm') {
            issues.push(`- 📉 **ZERO Traffic:** No sessions recorded in last 1 hour.`);
        }
        if (health.checks.gclidLast3Hours.status === 'alarm') {
            issues.push(`- 💸 **Ads Blindness:** No GCLID (ad click) recorded in last 3 hours.`);
        }
        if (health.checks.ingestPublishFailuresLast15m.status === 'degraded') {
            issues.push(`- 🟡 **Ingest Publish Failures:** ${health.checks.ingestPublishFailuresLast15m.count} publish failures in the last 15 minutes.`);
        }
        if (health.checks.ingestPublishFailuresLast15m.status === 'critical') {
            issues.push(`- 🚨 **Critical Ingest Failures:** ${health.checks.ingestPublishFailuresLast15m.count} publish failures in the last 15 minutes.`);
        }
        if (health.checks.ingestPublishFailuresLast15m.status === 'unknown') {
            issues.push(`- ❓ **Ingest Visibility Lost:** publish failure check returned unknown.`);
        }
        if (health.checks.billingReconciliationDriftLast1h.status === 'degraded') {
            issues.push(`- 📐 **Billing Drift:** ${health.checks.billingReconciliationDriftLast1h.count} site(s) exceeded reconciliation drift in the last hour.`);
        }

        const titleByStatus: Record<WatchtowerStatus, string> = {
            ok: 'WATCHTOWER STATUS OK',
            degraded: 'WATCHTOWER DEGRADED',
            alarm: 'WATCHTOWER DETECTED PIPELINE STALL',
            critical: 'WATCHTOWER CRITICAL',
        };
        const levelByStatus: Record<WatchtowerStatus, 'warning' | 'alarm' | 'info'> = {
            ok: 'info',
            degraded: 'warning',
            alarm: 'alarm',
            critical: 'alarm',
        };

        const alertMessage = `
**${titleByStatus[health.status]}**

Environment: \`${health.details.environment}\`
Time: ${health.details.timestamp}
Status: ${health.status}

**Detected Issues:**
${issues.join('\n')}

**Diagnostics:**
- Sessions (1h): ${health.checks.sessionsLastHour.count}
- GCLIDs (3h): ${health.checks.gclidLast3Hours.count}
- Ingest publish failures (15m): ${health.checks.ingestPublishFailuresLast15m.count}
- Billing drift sites (1h): ${health.checks.billingReconciliationDriftLast1h.count}

_Immediate investigation required._
        `.trim();

        // 1. Log for Sentry/Logs
        logError('WATCHTOWER_ALERT_STATE', { status: health.status, checks: health.checks });

        // 2. Send Telegram Notification
        await TelegramService.sendMessage(alertMessage, levelByStatus[health.status]);
    }
}
