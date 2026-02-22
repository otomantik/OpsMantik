
'use client';

import React from 'react';
import { formatTimestamp } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { TrendingUp, Phone, MapPin, ChevronRight, CornerDownRight } from 'lucide-react';

// Types from SessionGroup (need to be consistent)
export interface Event {
    id: string;
    event_category: string;
    event_action: string;
    event_label: string | null;
    event_value: number | null;
    metadata: Record<string, unknown>;
    created_at: string;
    url?: string;
    // Computed fields
    timeDiff?: number; // Optional in raw events
}

export interface EnrichedEvent extends Event {
    timeDiff: number; // Required in compressed events
}

export interface CompressedEvent {
    type: 'single' | 'group';
    id: string;
    event?: EnrichedEvent;
    events?: EnrichedEvent[];
    count?: number;
    firstTime: string;
    lastTime: string;
    timeDiff: number;
}

interface SessionCardExpandedProps {
    events: Event[];
    sortedEvents: Event[];
    compressedEvents: CompressedEvent[];
    expandedGroups: Set<string>;
    onToggleGroup: (groupId: string) => void;
    matchedCall: { phone_number?: string; lead_score?: number | null; created_at?: string } | null;
}

export function SessionCardExpanded({
    events,
    sortedEvents,
    compressedEvents,
    expandedGroups,
    onToggleGroup,
    matchedCall,
}: SessionCardExpandedProps) {
    const { t, toLocaleUpperCase } = useTranslation();

    // Get icon for event action
    const getEventIcon = (action: string | null | undefined) => {
        if (!action) return TrendingUp;
        const actionLower = action.toLowerCase();
        if (actionLower.includes('phone') || actionLower.includes('call') || actionLower.includes('whatsapp')) {
            return Phone;
        }
        if (actionLower.includes('page') || actionLower.includes('visit') || actionLower.includes('external') || actionLower.includes('hover')) {
            return MapPin;
        }
        return TrendingUp;
    };

    return (
        <div className="border-t border-slate-200 p-4 space-y-4 bg-white">
            {/* Event Timeline (Visual) */}
            <div>
                <p className="text-sm text-muted-foreground uppercase tracking-wider mb-3">
                    {toLocaleUpperCase(t('session.eventTimeline'))}
                </p>
                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    {(sortedEvents || []).slice(0, 15).map((event, index) => {
                        const Icon = getEventIcon(event?.event_action);
                        const isLast = index === sortedEvents.slice(0, 15).length - 1;
                        const isConversion = event.event_category === 'conversion';

                        return (
                            <div key={event.id} className="flex items-center gap-1 shrink-0 ml-2">
                                <div className="relative group">
                                    <div className={`
                    w-8 h-8 rounded-full flex items-center justify-center
                    ${isConversion ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                            event.event_category === 'acquisition' ? 'bg-yellow-50 text-yellow-800 border border-yellow-200' :
                                                'bg-white text-muted-foreground border border-slate-200'
                                        }
                    hover:scale-110 transition-transform cursor-pointer
                  `}>
                                        <Icon className="w-4 h-4" />
                                    </div>
                                    {/* Tooltip */}
                                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                        <div className="bg-popover text-popover-foreground text-sm px-2 py-1 rounded border border-border whitespace-nowrap shadow-sm">
                                            {event.event_action}
                                            {event.event_label && `: ${event.event_label}`}
                                        </div>
                                    </div>
                                </div>
                                {!isLast && (
                                    <TrendingUp className="w-3 h-3 text-muted-foreground shrink-0" />
                                )}
                            </div>
                        );
                    })}
                    {events.length > 15 && (
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                            <TrendingUp className="w-3 h-3 text-muted-foreground" />
                            <span className="text-sm px-2 py-1 rounded bg-white text-muted-foreground border border-slate-200 tabular-nums">
                                +{events.length - 15}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Event Details Table */}
            <div>
                <p className="text-sm text-muted-foreground uppercase tracking-wider mb-3">
                    {toLocaleUpperCase(t('session.eventDetails'))}
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border">
                                <th className="text-left py-2 px-3 text-muted-foreground">{t('table.time')}</th>
                                <th className="text-left py-2 px-3 text-muted-foreground">+{t('table.time')}</th>
                                <th className="text-left py-2 px-3 text-muted-foreground">{t('table.category')}</th>
                                <th className="text-left py-2 px-3 text-muted-foreground">{t('table.action')}</th>
                                <th className="text-left py-2 px-3 text-muted-foreground">{t('table.label')}</th>
                                <th className="text-left py-2 px-3 text-muted-foreground">{t('table.value')}</th>
                                <th className="text-left py-2 px-3 text-muted-foreground">URL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(compressedEvents || []).map((item) => {
                                if (item.type === 'single' && item.event) {
                                    // Single event (no compression)
                                    const event = item.event;
                                    const Icon = getEventIcon(event.event_action);
                                    const isConversion = event.event_category === 'conversion';

                                    return (
                                        <tr
                                            key={item.id}
                                            className={`border-b border-slate-200 hover:bg-slate-50 transition-colors ${isConversion ? 'bg-emerald-50/50' : ''}`}
                                        >
                                            <td className="py-2 px-3 text-foreground tabular-nums" suppressHydrationWarning>
                                                {formatTimestamp(event.created_at, {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    second: '2-digit',
                                                    fractionalSecondDigits: 3
                                                })}
                                            </td>
                                            <td className="py-2 px-3 text-muted-foreground tabular-nums">
                                                {item.timeDiff > 0 ? `+${item.timeDiff}s` : '—'}
                                            </td>
                                            <td className="py-2 px-3">
                                                <span className={`px-2 py-1 rounded text-sm border ${event.event_category === 'conversion' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                    event.event_category === 'acquisition' ? 'bg-yellow-50 text-yellow-800 border-yellow-200' :
                                                        event.event_category === 'interaction' ? 'bg-white text-muted-foreground border-slate-200' :
                                                            'bg-white text-muted-foreground border-slate-200'
                                                    }`}>
                                                    {toLocaleUpperCase(
                                                        event.event_category === 'conversion' ? t('intent.conversion') :
                                                            event.event_category === 'acquisition' ? 'ACQUISITION' :
                                                                event.event_category === 'interaction' ? 'INTERACTION' :
                                                                    event.event_category
                                                    )}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 text-foreground flex items-center gap-2">
                                                <Icon className="w-3 h-3" />
                                                {event.event_action}
                                            </td>
                                            <td className="py-2 px-3 text-muted-foreground">
                                                {event.event_label || '—'}
                                            </td>
                                            <td className="py-2 px-3 text-muted-foreground tabular-nums">
                                                {event.event_value !== null ? event.event_value : '—'}
                                            </td>
                                            <td className="py-2 px-3 text-muted-foreground text-sm max-w-xs truncate" title={event.url}>
                                                {event.url || '—'}
                                            </td>
                                        </tr>
                                    );
                                } else if (item.type === 'group' && item.events) {
                                    // Compressed group
                                    const firstEvent = item.events[0];
                                    const Icon = getEventIcon(firstEvent.event_action);
                                    const isConversion = firstEvent.event_category === 'conversion';
                                    const isExpanded = expandedGroups.has(item.id);

                                    return (
                                        <React.Fragment key={item.id}>
                                            {/* Compressed row */}
                                            <tr
                                                className={`border-b border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer ${isConversion ? 'bg-emerald-50/50' : ''}`}
                                                onClick={() => onToggleGroup(item.id)}
                                            >
                                                <td className="py-2 px-3 text-foreground tabular-nums" suppressHydrationWarning>
                                                    {formatTimestamp(item.firstTime, {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                        second: '2-digit',
                                                        fractionalSecondDigits: 3
                                                    })}
                                                    {item.events.length > 1 && (
                                                        <span className="text-muted-foreground ml-1 tabular-nums" suppressHydrationWarning>
                                                            - {formatTimestamp(item.lastTime, {
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                                second: '2-digit',
                                                                fractionalSecondDigits: 3
                                                            })}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-2 px-3 text-muted-foreground tabular-nums">
                                                    {item.timeDiff > 0 ? `+${item.timeDiff}s` : '—'}
                                                </td>
                                                <td className="py-2 px-3">
                                                    <span className={`px-2 py-1 rounded text-sm border ${firstEvent.event_category === 'conversion' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                        firstEvent.event_category === 'acquisition' ? 'bg-yellow-50 text-yellow-800 border-yellow-200' :
                                                            firstEvent.event_category === 'interaction' ? 'bg-white text-muted-foreground border-slate-200' :
                                                                'bg-white text-muted-foreground border-slate-200'
                                                        }`}>
                                                        {toLocaleUpperCase(firstEvent.event_category)}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-3 text-foreground flex items-center gap-2">
                                                    <ChevronRight
                                                        className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                                    />
                                                    <Icon className="w-3 h-3" />
                                                    {firstEvent.event_action}
                                                    <span className="ml-2 px-2 py-1 rounded bg-muted text-muted-foreground border border-border text-sm font-semibold tabular-nums">
                                                        ×{item.count}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-3 text-muted-foreground">
                                                    {firstEvent.event_label || '—'}
                                                </td>
                                                <td className="py-2 px-3 text-muted-foreground tabular-nums">
                                                    {firstEvent.event_value !== null ? firstEvent.event_value : '—'}
                                                </td>
                                                <td className="py-2 px-3 text-muted-foreground text-sm max-w-xs truncate" title={firstEvent.url}>
                                                    {firstEvent.url || '—'}
                                                </td>
                                            </tr>
                                            {/* Expanded rows (if toggled) */}
                                            {isExpanded && item.events.map((event) => (
                                                <tr
                                                    key={`${item.id}-${event.id}`}
                                                    className={`border-b border-slate-200 hover:bg-slate-50 transition-colors ${isConversion ? 'bg-emerald-50/30' : ''}`}
                                                >
                                                    <td className="py-1.5 px-3 pl-8 text-muted-foreground text-sm tabular-nums" suppressHydrationWarning>
                                                        {formatTimestamp(event.created_at, {
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                            second: '2-digit',
                                                            fractionalSecondDigits: 3
                                                        })}
                                                    </td>
                                                    <td className="py-1.5 px-3 text-muted-foreground text-sm tabular-nums">
                                                        {event.timeDiff > 0 ? `+${event.timeDiff}s` : '—'}
                                                    </td>
                                                    <td className="py-1.5 px-3">
                                                        <span className={`px-2 py-1 rounded text-sm border ${event.event_category === 'conversion' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                            event.event_category === 'acquisition' ? 'bg-yellow-50 text-yellow-800 border-yellow-200' :
                                                                event.event_category === 'interaction' ? 'bg-white text-muted-foreground border-slate-200' :
                                                                    'bg-white text-muted-foreground border-slate-200'
                                                            }`}>
                                                            {toLocaleUpperCase(event.event_category)}
                                                        </span>
                                                    </td>
                                                    <td className="py-1.5 px-3 text-foreground text-sm flex items-center gap-2">
                                                        <CornerDownRight className="w-2.5 h-2.5 text-muted-foreground/30" />
                                                        <Icon className="w-2.5 h-2.5" />
                                                        {event.event_action}
                                                    </td>
                                                    <td className="py-1.5 px-3 text-muted-foreground text-sm">
                                                        {event.event_label || '—'}
                                                    </td>
                                                    <td className="py-1.5 px-3 text-muted-foreground text-sm tabular-nums">
                                                        {event.event_value !== null ? event.event_value : '—'}
                                                    </td>
                                                    <td className="py-1.5 px-3 text-muted-foreground text-sm max-w-xs truncate" title={event.url}>
                                                        {event.url || '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    );
                                }
                                return null;
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Phone Match Info */}
            {matchedCall && (
                <div className="mt-4 p-3 rounded bg-rose-50 border border-rose-200">
                    <p className="text-sm text-rose-700 mb-1">
                        {t('session.phoneMatched')}: {matchedCall.phone_number}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground tabular-nums">
                        <span>{t('table.value')}: {matchedCall.lead_score}</span>
                        <span suppressHydrationWarning>{t('session.matchTime')}: {formatTimestamp(matchedCall.created_at)}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
