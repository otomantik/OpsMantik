
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { X } from 'lucide-react';
import { formatTimestamp } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

// Define the Session type here to avoid importing circular dependencies or redefine exactly what we need
interface VisitorSession {
    id: string;
    created_at: string;
    attribution_source?: string | null;
    device_type?: string | null;
    city?: string | null;
    lead_score?: number | null;
}

interface VisitorCall {
    id: string;
    phone_number: string;
    lead_score: number;
    matched_session_id?: string | null;
    created_at: string;
}

interface VisitorHistoryDrawerProps {
    fingerprint: string;
    siteId: string;
    visitorSessions: VisitorSession[] | null;
    visitorCalls: VisitorCall[] | null;
    sessionCount24h: number;
    isLoading: boolean;
    onClose: () => void;
    currentSessionId: string;
}

export function VisitorHistoryDrawer({
    fingerprint,
    // siteId, // Not used in render but might be needed if we add more logic
    visitorSessions,
    visitorCalls,
    sessionCount24h,
    isLoading,
    onClose,
    currentSessionId,
}: VisitorHistoryDrawerProps) {
    const { t } = useTranslation();

    // Guard clause: if no fingerprint, we shouldn't even show this, but render gracefully
    if (!fingerprint) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end lg:items-center justify-center p-4">
            <Card className="w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col bg-white">
                <CardContent className="p-0 flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-border">
                        <div>
                            <h3 className="text-lg font-semibold text-foreground">{t('visitor.title')}</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                                {t('visitor.fingerprint')}: <span className="text-foreground tabular-nums">{fingerprint.slice(0, 10)}…</span>
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={onClose}
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {isLoading ? (
                            <div className="text-center py-8">
                                <p className="text-sm text-muted-foreground">{t('visitor.loading')}</p>
                            </div>
                        ) : !visitorSessions || visitorSessions.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-sm text-muted-foreground">{t('visitor.noSessions')}</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {(visitorSessions || []).map((session) => (
                                    <div
                                        key={session.id}
                                        className={`p-3 rounded border transition-colors ${session.id === currentSessionId
                                            ? 'bg-emerald-50 border-emerald-200'
                                            : 'bg-background border-border'
                                            } hover:bg-muted/40`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap mb-2">
                                                    <span className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
                                                        {formatTimestamp(session.created_at, {
                                                            day: '2-digit',
                                                            month: '2-digit',
                                                            year: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })}
                                                    </span>
                                                    {session.id === currentSessionId && (
                                                        <span className="text-sm px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                                                            {t('visitor.current')}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {session.attribution_source && (
                                                        <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border">
                                                            {session.attribution_source}
                                                        </span>
                                                    )}
                                                    {session.device_type && (
                                                        <span className="text-sm px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                                            {session.device_type}
                                                        </span>
                                                    )}
                                                    {session.city && session.city !== 'Unknown' && (
                                                        <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border">
                                                            {session.city}
                                                        </span>
                                                    )}
                                                    {session.lead_score !== null && session.lead_score !== undefined && (
                                                        <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                                                            {t('visitor.score')}: {session.lead_score}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm text-muted-foreground tabular-nums">
                                                    {session.id.slice(0, 8)}...
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Other Calls Section - Fingerprint-only calls */}
                        {visitorCalls && visitorCalls.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-border">
                                <h4 className="text-sm font-semibold text-foreground mb-3">{t('visitor.otherCalls')}</h4>
                                <div className="space-y-2">
                                    {(visitorCalls || []).map((call) => (
                                        <div
                                            key={call.id}
                                            className="p-3 rounded bg-muted/40 border border-border hover:bg-muted/60 transition-colors"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap mb-2">
                                                        <span className="text-sm text-foreground tabular-nums">{call.phone_number}</span>
                                                        <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                                                            Score: {call.lead_score}
                                                        </span>
                                                        {call.matched_session_id && (
                                                            <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                                                                {t('visitor.matchedTo')}: {call.matched_session_id.slice(0, 8)}...
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
                                                        {formatTimestamp(call.created_at, {
                                                            day: '2-digit',
                                                            month: '2-digit',
                                                            year: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-border bg-muted/30">
                        <p className="text-sm text-muted-foreground text-center tabular-nums">
                            {t('visitor.showing', {
                                sessions: visitorSessions?.length ?? 0,
                                calls: visitorCalls && visitorCalls.length > 0 ? `, ${visitorCalls.length} ${t('dashboard.calls').toLowerCase()}` : '',
                                period: sessionCount24h > 0 ? ` • ${sessionCount24h} ${t('health.hoursAgo', { n: 24 }).toLowerCase()}` : ''
                            })}
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
