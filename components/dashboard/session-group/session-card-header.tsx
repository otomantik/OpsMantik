'use client';

import { Button } from '@/components/ui/button';
import { Copy, Clock, CheckCircle2, ChevronUp, ChevronDown, History, BadgeCheck, Phone, Flame } from 'lucide-react';
import { formatTimestamp, formatLocation, cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { getLocalizedLabel } from '@/lib/i18n/mapping';

interface SessionCardHeaderProps {
    session: {
        id: string;
        first_event_created_at: string;
        duration: number;
        events_count: number;
        conversion_count: number;
        has_phone_call: boolean;
        matched_call_number: string | null;
        lead_score: number;
        intelligence_summary: string;
        attribution_source: string | null;
        gclid: string | null;
        fingerprint: string | null;
        is_returning: boolean;
        session_count_24h: number;
        site_id: string | undefined;
        city: string | null;
        district: string | null;
        device_type: string | null;
        os: string | null;
        browser: string | null;
    };
    isExpanded: boolean;
    onToggle: () => void;
    onCopyFingerprint: (e: React.MouseEvent, fp: string) => void;
    onHistoryClick: (e: React.MouseEvent) => void;
}


export function SessionCardHeader({
    session, isExpanded, onToggle, onCopyFingerprint, onHistoryClick
}: SessionCardHeaderProps) {
    const { t } = useTranslation();
    const eventCount = session.events_count ?? 0;
    const conversionCount = session.conversion_count ?? 0;
    const hasPhoneCall = session.has_phone_call;
    const matchedCallNumber = session.matched_call_number;
    const leadScore = session.lead_score;
    const intelligenceSummary = session.intelligence_summary;
    const attributionSource = session.attribution_source;
    const gclid = session.gclid;
    const fingerprint = session.fingerprint;
    const isReturning = session.is_returning;
    const sessionCount24h = session.session_count_24h;
    const siteId = session.site_id;
    const firstEventCreatedAt = session.first_event_created_at;
    const sessionDuration = session.duration;

    const locationLabel = formatLocation(session.city, session.district);

    return (
        <div
            className="p-4 cursor-pointer hover:bg-slate-50 transition-colors"
            onClick={onToggle}
        >
            <div className="flex justify-between items-start">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <p className="text-sm font-semibold text-foreground truncate">
                            {t('session.sessionLabel')}: <span className="text-emerald-700">{session.id.slice(0, 8)}…</span>
                        </p>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-emerald-700 hover:bg-emerald-50"
                            onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(session.id);
                            }}
                            title={t('session.copySessionId')}
                        >
                            <Copy className="w-3.5 h-3.5" />
                        </Button>
                        {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        )}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
                                {formatTimestamp(firstEventCreatedAt, {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                })}
                            </p>
                        </div>
                        {sessionDuration > 0 && (
                            <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                                {sessionDuration}{t('common.unit.second.short')}
                            </span>
                        )}
                        <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                            {t('session.eventCount', { count: eventCount })}
                        </span>
                        {conversionCount > 0 && (
                            <span className="text-sm px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium tabular-nums flex items-center gap-1">
                                <BadgeCheck className="w-3 h-3" />
                                {t('session.conversions', { count: conversionCount })}
                            </span>
                        )}
                        {hasPhoneCall && (
                            <span className="text-sm px-2 py-1 rounded bg-blue-100 text-blue-700 border border-blue-200 font-medium flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {t('session.phone')}
                            </span>
                        )}
                        {matchedCallNumber && (
                            <span className="text-sm px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                {t('session.matched', { phone: matchedCallNumber })}
                            </span>
                        )}
                    </div>
                </div>
                <div className="text-right">
                    <p className={cn("text-3xl font-bold tabular-nums", {
                        'text-amber-700': leadScore >= 71,
                        'text-blue-700': leadScore >= 31 && leadScore < 71,
                        'text-muted-foreground': leadScore < 31
                    })}>
                        {leadScore}
                    </p>
                    {leadScore >= 71 && (
                        <p className="text-sm text-amber-800 font-semibold mt-1 flex items-center justify-end gap-1">
                            <Flame className="w-3 h-3" />
                            {t('session.hotLead')}
                        </p>
                    )}
                    <p className="text-sm text-muted-foreground uppercase tracking-wider mt-2">
                        {intelligenceSummary}
                    </p>
                </div>
            </div>

            {/* Quick Info Row - Badge Style */}
            <div className="mt-3 pt-2 border-t border-border">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border">
                        {t('session.source')}: <span className="text-foreground font-medium">{getLocalizedLabel(attributionSource, t)}</span>
                    </span>
                    {gclid && (
                        <span className="text-sm px-2 py-1 rounded bg-yellow-50 text-yellow-800 border border-yellow-200 tabular-nums">
                            {t('session.gclid')}: <span className="font-medium">{gclid.slice(0, 12)}…</span>
                        </span>
                    )}
                    {fingerprint && (
                        <span
                            className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border flex items-center gap-1 cursor-pointer hover:bg-muted/70 transition-colors tabular-nums"
                            title={t('session.copyFingerprintTooltip', { fingerprint: fingerprint })}
                            onClick={(e) => onCopyFingerprint(e, fingerprint)}
                        >
                            {t('session.fingerprintShort')}: <span className="text-foreground font-medium">{fingerprint.slice(0, 10)}…</span>
                            <Copy className="w-3 h-3 opacity-60" />
                        </span>
                    )}
                    {isReturning && (
                        <span className="text-sm px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                            {t('session.returning')}
                        </span>
                    )}
                    {sessionCount24h && sessionCount24h > 1 && (
                        <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                            {t('session.sessions24h', { n: sessionCount24h })}
                        </span>
                    )}
                    {fingerprint && siteId && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 px-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted"
                            onClick={onHistoryClick}
                            title={t('session.viewHistory')}
                        >
                            <History className="w-3 h-3 mr-1" />
                            {t('session.history')}
                        </Button>
                    )}
                </div>
            </div>

            {/* Context Chips Row - Always show, use "—" for missing values */}
            <div className="mt-2 pt-2 border-t border-border">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                        {t('session.locationLabel')}:{' '}
                        <span className="text-foreground font-medium">
                            {locationLabel && locationLabel !== 'Unknown' && locationLabel !== t('misc.unknown') ? locationLabel : t('common.na')}
                        </span>
                    </span>
                    <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                        {t('session.deviceLabel')}: <span className="text-foreground font-medium">{getLocalizedLabel(session.device_type, t)}</span>
                    </span>
                    {session.os && session.os !== 'Unknown' && (
                        <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                            {t('session.osLabel')}: <span className="text-foreground font-medium">{session.os}</span>
                        </span>
                    )}
                    {session.browser && session.browser !== 'Unknown' && (
                        <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                            {t('session.browserLabel')}: <span className="text-foreground font-medium">{session.browser}</span>
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
