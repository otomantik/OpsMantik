
'use client';

import { Button } from '@/components/ui/button';
import { Copy, Clock, CheckCircle2, ChevronUp, ChevronDown, History } from 'lucide-react';
import { formatTimestamp, formatLocation } from '@/lib/utils';

interface SessionCardHeaderProps {
    sessionId: string;
    isExpanded: boolean;
    onToggle: () => void;
    onCopySessionId: (e: React.MouseEvent) => void;
    onCopyFingerprint: (e: React.MouseEvent, fp: string) => void;
    onToggleVisitorHistory: (e: React.MouseEvent) => void;

    firstEventCreatedAt: string;
    sessionDuration: number;
    eventCount: number;
    conversionCount: number;
    hasPhoneCall: boolean;
    matchedCall: { phone_number?: string } | null;
    leadScore: number;
    intelligenceSummary: string;

    attributionSource: string | null;
    gclid: string | null;
    fingerprint: string | null;
    isReturning: boolean;
    sessionCount24h: number;
    siteId: string | undefined;

    city: string | null;
    district: string | null;
    device: string | null;
    os: string | null;
    browser: string | null;
}

export function SessionCardHeader({
    sessionId, isExpanded, onToggle, onCopySessionId, onCopyFingerprint, onToggleVisitorHistory,
    firstEventCreatedAt, sessionDuration, eventCount, conversionCount, hasPhoneCall, matchedCall,
    leadScore, intelligenceSummary, attributionSource, gclid, fingerprint, isReturning, sessionCount24h, siteId,
    city, district, device, os, browser
}: SessionCardHeaderProps) {

    const locationLabel = formatLocation(city, district);

    return (
        <div
            className="p-4 cursor-pointer hover:bg-slate-50 transition-colors"
            onClick={onToggle}
        >
            <div className="flex justify-between items-start">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <p className="text-sm font-semibold text-foreground truncate">
                            Session: <span className="text-emerald-700">{sessionId.slice(0, 8)}…</span>
                        </p>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-emerald-700 hover:bg-emerald-50"
                            onClick={onCopySessionId}
                            title="Copy Session ID"
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
                                {sessionDuration}s
                            </span>
                        )}
                        <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                            {eventCount} events
                        </span>
                        {conversionCount > 0 && (
                            <span className="text-sm px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium tabular-nums">
                                {conversionCount} CONVERSION{conversionCount > 1 ? 'S' : ''}
                            </span>
                        )}
                        {hasPhoneCall && (
                            <span className="text-sm px-2 py-1 rounded bg-blue-100 text-blue-700 border border-blue-200 font-medium">
                                Phone
                            </span>
                        )}
                        {matchedCall && (
                            <span className="text-sm px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                MATCHED: {matchedCall.phone_number}
                            </span>
                        )}
                    </div>
                </div>
                <div className="text-right">
                    <p className={`text-3xl font-bold tabular-nums ${leadScore >= 71 ? 'text-amber-700' :
                        leadScore >= 31 ? 'text-blue-700' :
                            'text-muted-foreground'
                        }`}>
                        {leadScore}
                    </p>
                    {leadScore >= 71 && (
                        <p className="text-sm text-amber-800 font-semibold mt-1">HOT LEAD</p>
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
                        Source: <span className="text-foreground font-medium">{attributionSource}</span>
                    </span>
                    {gclid && (
                        <span className="text-sm px-2 py-1 rounded bg-yellow-50 text-yellow-800 border border-yellow-200 tabular-nums">
                            GCLID: <span className="font-medium">{gclid.slice(0, 12)}…</span>
                        </span>
                    )}
                    {fingerprint && (
                        <span
                            className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border flex items-center gap-1 cursor-pointer hover:bg-muted/70 transition-colors tabular-nums"
                            title={`Fingerprint: ${fingerprint}\nClick to copy full fingerprint`}
                            onClick={(e) => onCopyFingerprint(e, fingerprint)}
                        >
                            FP: <span className="text-foreground font-medium">{fingerprint.slice(0, 10)}…</span>
                            <Copy className="w-3 h-3 opacity-60" />
                        </span>
                    )}
                    {isReturning && (
                        <span className="text-sm px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                            Returning
                        </span>
                    )}
                    {sessionCount24h > 0 && (
                        <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                            Sessions 24h: {sessionCount24h}
                        </span>
                    )}
                    {fingerprint && siteId && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 px-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted"
                            onClick={onToggleVisitorHistory}
                            title="View visitor history"
                        >
                            <History className="w-3 h-3 mr-1" />
                            History
                        </Button>
                    )}
                </div>
            </div>

            {/* Context Chips Row - Always show, use "—" for missing values */}
            <div className="mt-2 pt-2 border-t border-border">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                        Location:{' '}
                        <span className="text-foreground font-medium">
                            {locationLabel && locationLabel !== 'Unknown' ? locationLabel : '—'}
                        </span>
                    </span>
                    <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                        Device: <span className="text-foreground font-medium">{device || '—'}</span>
                    </span>
                    {os && os !== 'Unknown' && (
                        <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                            OS: <span className="text-foreground font-medium">{os}</span>
                        </span>
                    )}
                    {browser && browser !== 'Unknown' && (
                        <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                            Browser: <span className="text-foreground font-medium">{browser}</span>
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
