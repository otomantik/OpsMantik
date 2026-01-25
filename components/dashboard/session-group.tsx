'use client';

import { useState, memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Phone, MapPin, TrendingUp, ChevronDown, ChevronUp, CheckCircle2, Clock, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSessionData } from '@/lib/hooks/use-session-data';

interface Event {
  id: string;
  event_category: string;
  event_action: string;
  event_label: string | null;
  event_value: number | null;
  metadata: any;
  created_at: string;
  url?: string;
}

interface SessionGroupProps {
  sessionId: string;
  events: Event[];
}

export const SessionGroup = memo(function SessionGroup({ sessionId, events }: SessionGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const firstEvent = events[events.length - 1]; // Oldest event
  const lastEvent = events[0]; // Newest event
  const metadata = firstEvent.metadata || {};
  const leadScore = metadata.lead_score || 0;
  
  // Use extracted hook for session data fetching and call matching
  const { sessionData, matchedCall, isLoading: isLoadingCall } = useSessionData(sessionId, metadata);
  
  // Use session data first, fallback to event metadata
  // Note: computeAttribution always returns a value, so 'Organic' fallback is redundant
  const attributionSource = sessionData?.attribution_source || metadata.attribution_source;
  const intelligenceSummary = metadata.intelligence_summary || 'Standard Traffic';
  const fingerprint = sessionData?.fingerprint || metadata.fingerprint || metadata.fp || null;
  const gclid = sessionData?.gclid || metadata.gclid || null;
  
  // Context chips data - prefer session, fallback to metadata
  const city = sessionData?.city || metadata.city || null;
  const district = sessionData?.district || metadata.district || null;
  const device = sessionData?.device_type || metadata.device_type || null;
  const os = metadata.os || null;
  const browser = metadata.browser || null;

  // Get icon for event action
  const getEventIcon = (action: string) => {
    const actionLower = action.toLowerCase();
    if (actionLower.includes('phone') || actionLower.includes('call') || actionLower.includes('whatsapp')) {
      return Phone;
    }
    if (actionLower.includes('page') || actionLower.includes('visit') || actionLower.includes('external') || actionLower.includes('hover')) {
      return MapPin;
    }
    return TrendingUp;
  };

  // Get border color based on lead score
  const getBorderColor = (score: number) => {
    if (score >= 71) {
      return 'border-orange-500/70 neon-orange-pulse';
    }
    if (score >= 31) {
      return 'border-blue-500/50';
    }
    return 'border-slate-600/50';
  };

  // Get border glow for hot leads
  const getBorderGlow = (score: number) => {
    if (score >= 71) {
      return {
        boxShadow: '0 0 10px rgba(249, 115, 22, 0.4), 0 0 20px rgba(249, 115, 22, 0.2)',
      };
    }
    return {};
  };

  // Sort events by time (oldest to newest) with id tie-breaker for determinism
  const sortedEvents = [...events].sort((a, b) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    // Tie-breaker: use id for deterministic order
    return a.id.localeCompare(b.id);
  });

  // Calculate session duration
  const sessionDuration = sortedEvents.length > 1
    ? Math.round((new Date(lastEvent.created_at).getTime() - new Date(firstEvent.created_at).getTime()) / 1000)
    : 0;

  // Count conversions
  const conversionCount = events.filter(e => e.event_category === 'conversion').length;
  const hasPhoneCall = events.some(e => 
    e.event_action?.toLowerCase().includes('phone') || 
    e.event_action?.toLowerCase().includes('call')
  );

  // Calculate time differences between events
  const eventsWithTimeDiff = sortedEvents.map((event, index) => {
    const timeDiff = index > 0 
      ? Math.round((new Date(event.created_at).getTime() - new Date(sortedEvents[index - 1].created_at).getTime()) / 1000)
      : 0;
    return { ...event, timeDiff };
  });

  const handleCopySessionId = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent accordion toggle
    try {
      await navigator.clipboard.writeText(sessionId);
    } catch (err) {
      console.error('[SESSION_GROUP] Failed to copy session ID:', err);
    }
  };

  return (
    <Card 
      className={`glass ${getBorderColor(leadScore)} transition-all duration-300`}
      style={getBorderGlow(leadScore)}
      data-session-id={sessionId}
    >
      <CardContent className="p-0">
        {/* Clickable Header */}
        <div 
          className="p-4 cursor-pointer hover:bg-slate-800/30 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <p className="font-mono text-sm font-semibold text-slate-200 truncate">
                  SESSION: <span className="text-emerald-400">{sessionId.slice(0, 8)}...</span>
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 p-0 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
                  onClick={handleCopySessionId}
                  title="Copy Session ID"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <p className="font-mono text-xs text-slate-500">
                    {new Date(firstEvent.created_at).toLocaleString('tr-TR', {
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
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
                    {sessionDuration}s
                  </span>
                )}
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
                  {events.length} events
                </span>
                {conversionCount > 0 && (
                  <span className="font-mono text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">
                    {conversionCount} CONVERSION{conversionCount > 1 ? 'S' : ''}
                  </span>
                )}
                {hasPhoneCall && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    📞 CALL
                  </span>
                )}
                {matchedCall && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    MATCHED: {matchedCall.phone_number}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className={`font-mono text-3xl font-bold ${
                leadScore >= 71 ? 'text-orange-400' : 
                leadScore >= 31 ? 'text-blue-400' : 
                'text-slate-400'
              }`}>
                {leadScore}
              </p>
              {leadScore >= 71 && (
                <p className="font-mono text-xs text-orange-400 animate-pulse font-semibold mt-1">HOT LEAD</p>
              )}
              <p className="font-mono text-[10px] text-slate-600 uppercase tracking-wider mt-2 opacity-60">
                {intelligenceSummary}
              </p>
            </div>
          </div>
          
          {/* Quick Info Row - Badge Style */}
          <div className="mt-3 pt-2 border-t border-slate-800/50">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs px-2 py-1 rounded bg-slate-700/50 text-slate-300 border border-slate-600/30">
                SOURCE: <span className="text-slate-100 font-semibold">{attributionSource}</span>
              </span>
              {gclid && (
                <span className="font-mono text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                  GCLID: <span className="text-purple-300">{gclid.slice(0, 12)}...</span>
                </span>
              )}
              {fingerprint && (
                <span className="font-mono text-xs px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  FP: <span className="text-cyan-300">{fingerprint.length > 12 ? `${fingerprint.slice(0, 8)}...${fingerprint.slice(-4)}` : fingerprint}</span>
                </span>
              )}
            </div>
          </div>

          {/* Context Chips Row - Always show, use "—" for missing values */}
          <div className="mt-2 pt-2 border-t border-slate-800/30">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 min-w-0 truncate">
                CITY: <span className="text-indigo-300 font-semibold">{city && city !== 'Unknown' ? city : '—'}</span>
              </span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 min-w-0 truncate">
                DISTRICT: <span className="text-violet-300 font-semibold">{district || '—'}</span>
              </span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 min-w-0 truncate">
                DEVICE: <span className="text-amber-300 font-semibold">{device || '—'}</span>
              </span>
              {os && os !== 'Unknown' && (
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-teal-500/20 text-teal-400 border border-teal-500/30 min-w-0 truncate">
                  OS: <span className="text-teal-300 font-semibold">{os}</span>
                </span>
              )}
              {browser && browser !== 'Unknown' && (
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 min-w-0 truncate">
                  BROWSER: <span className="text-sky-300 font-semibold">{browser}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Content - Event Timeline & Time Table */}
        {isExpanded && (
          <div className="border-t border-slate-800/50 p-4 space-y-4">
            {/* Event Timeline (Visual) */}
            <div>
              <p className="font-mono text-xs text-slate-400 uppercase tracking-wider mb-3">
                Event Timeline
              </p>
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {sortedEvents.slice(0, 15).map((event, index) => {
                  const Icon = getEventIcon(event.event_action);
                  const isLast = index === sortedEvents.slice(0, 15).length - 1;
                  const isConversion = event.event_category === 'conversion';
                  
                  return (
                    <div key={event.id} className="flex items-center gap-1 flex-shrink-0">
                      <div className="relative group">
                        <div className={`
                          w-8 h-8 rounded-full flex items-center justify-center
                          ${isConversion ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                            event.event_category === 'acquisition' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                            'bg-slate-700/50 text-slate-300 border border-slate-600/30'
                          }
                          hover:scale-110 transition-transform cursor-pointer
                        `}>
                          <Icon className="w-4 h-4" />
                        </div>
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                          <div className="bg-slate-800 text-slate-200 text-xs font-mono px-2 py-1 rounded border border-slate-700 whitespace-nowrap">
                            {event.event_action}
                            {event.event_label && `: ${event.event_label}`}
                          </div>
                        </div>
                      </div>
                      {!isLast && (
                        <TrendingUp className="w-3 h-3 text-slate-600 flex-shrink-0" />
                      )}
                    </div>
                  );
                })}
                {events.length > 15 && (
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <TrendingUp className="w-3 h-3 text-slate-600" />
                    <span className="font-mono text-[10px] px-2 py-1 rounded bg-slate-800/50 text-slate-400 border border-slate-700/30">
                      +{events.length - 15}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Event Details Table */}
            <div>
              <p className="font-mono text-xs text-slate-400 uppercase tracking-wider mb-3">
                Event Details & Time Table
              </p>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800/50">
                      <th className="text-left py-2 px-3 text-slate-400">Time</th>
                      <th className="text-left py-2 px-3 text-slate-400">+Time</th>
                      <th className="text-left py-2 px-3 text-slate-400">Category</th>
                      <th className="text-left py-2 px-3 text-slate-400">Action</th>
                      <th className="text-left py-2 px-3 text-slate-400">Label</th>
                      <th className="text-left py-2 px-3 text-slate-400">Value</th>
                      <th className="text-left py-2 px-3 text-slate-400">URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventsWithTimeDiff.map((event, index) => {
                      const Icon = getEventIcon(event.event_action);
                      const isConversion = event.event_category === 'conversion';
                      
                      return (
                        <tr 
                          key={event.id} 
                          className={`border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors ${
                            isConversion ? 'bg-emerald-500/5' : ''
                          }`}
                        >
                          <td className="py-2 px-3 text-slate-300">
                            {new Date(event.created_at).toLocaleTimeString('tr-TR', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                              fractionalSecondDigits: 3
                            })}
                          </td>
                          <td className="py-2 px-3 text-slate-500">
                            {event.timeDiff > 0 ? `+${event.timeDiff}s` : '—'}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              event.event_category === 'conversion' ? 'bg-emerald-500/20 text-emerald-400' :
                              event.event_category === 'acquisition' ? 'bg-blue-500/20 text-blue-400' :
                              event.event_category === 'interaction' ? 'bg-purple-500/20 text-purple-400' :
                              'bg-slate-700/50 text-slate-300'
                            }`}>
                              {event.event_category.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-200 flex items-center gap-2">
                            <Icon className="w-3 h-3" />
                            {event.event_action}
                          </td>
                          <td className="py-2 px-3 text-slate-400">
                            {event.event_label || '—'}
                          </td>
                          <td className="py-2 px-3 text-slate-400">
                            {event.event_value !== null ? event.event_value : '—'}
                          </td>
                          <td className="py-2 px-3 text-slate-500 text-[10px] max-w-xs truncate" title={event.url}>
                            {event.url || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Phone Match Info */}
            {matchedCall && (
              <div className="mt-4 p-3 rounded bg-rose-500/10 border border-rose-500/30">
                <p className="font-mono text-xs text-rose-400 mb-1">
                  📞 TELEFON EŞLEŞTİ: {matchedCall.phone_number}
                </p>
                <div className="flex items-center gap-4 text-[10px] text-slate-400">
                  <span>Score: {matchedCall.lead_score}</span>
                  <span>Match Time: {new Date(matchedCall.created_at).toLocaleString('tr-TR')}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if sessionId or events array reference changes
  return prevProps.sessionId === nextProps.sessionId && 
         prevProps.events === nextProps.events;
});
