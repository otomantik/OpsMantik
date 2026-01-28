'use client';

/**
 * LiveFeed - Real-time event stream with month partition filtering
 * 
 * Acceptance Criteria:
 * - Realtime feed streams without double subscriptions
 * - Month partition filter enforced (session_month check)
 * - RLS compliance via JOIN patterns
 * - Events capped at 100, sessions at 10 displayed
 * 
 * Security: Uses anon key only (createClient), no service role leakage
 */
import { useEffect, useState, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { isDebugEnabled } from '@/lib/utils';
import { Activity, FileText, MessageCircle, MousePointerClick, Phone } from 'lucide-react';
import { RealtimeChannel } from '@supabase/supabase-js';

interface Event {
  id: string;
  session_id: string;
  session_month: string;
  event_category: string;
  event_action: string;
  event_label: string | null;
  event_value: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  url?: string;
}

interface LiveFeedProps {
  siteId?: string;
  adsOnly?: boolean;
}

export function LiveFeed({ siteId, adsOnly = false }: LiveFeedProps = {}) {
  const [events, setEvents] = useState<Event[]>([]);
  const [userSites, setUserSites] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const subscriptionRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const duplicateWarningRef = useRef<boolean>(false);

  // Filter state (optional; hidden in adsOnly)
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  const activityRows = useMemo(() => {
    const sorted = [...events].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      if (tb !== ta) return tb - ta;
      return b.id.localeCompare(a.id);
    });
    return sorted.slice(0, 15);
  }, [events]);

  function classify(e: Event): { label: string; Icon: any; badgeClass: string; iconBg: string; iconColor: string } {
    const action = (e.event_action || '').toLowerCase();
    const category = (e.event_category || '').toLowerCase();

    // WhatsApp (green, WA-like)
    if (action.includes('whatsapp')) {
      return {
        label: 'WhatsApp',
        Icon: MessageCircle,
        badgeClass: 'bg-green-100 text-green-700 border border-green-200',
        iconBg: 'bg-green-100',
        iconColor: 'text-green-700',
      };
    }

    // Phone (blue)
    if (action.includes('phone') || action.includes('call')) {
      return {
        label: 'Phone',
        Icon: Phone,
        badgeClass: 'bg-blue-100 text-blue-700 border border-blue-200',
        iconBg: 'bg-blue-100',
        iconColor: 'text-blue-700',
      };
    }

    // Forms / conversion
    if (category === 'conversion' && action === 'form_submit') {
      return {
        label: 'Form',
        Icon: FileText,
        badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
        iconBg: 'bg-slate-100',
        iconColor: 'text-slate-700',
      };
    }

    // Ads clicks / acquisition (subtle yellow)
    if (category === 'acquisition') {
      return {
        label: 'Ads',
        Icon: MousePointerClick,
        badgeClass: 'bg-yellow-50 text-yellow-800 border border-yellow-200',
        iconBg: 'bg-yellow-50',
        iconColor: 'text-yellow-800',
      };
    }

    return {
      label: 'Event',
      Icon: Activity,
      badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
      iconBg: 'bg-slate-100',
      iconColor: 'text-slate-700',
    };
  }

  // Memoized grouping: compute groupedSessions from events only when events change
  const groupedSessions = useMemo(() => {
    if (events.length === 0) return {};

    const grouped: Record<string, Event[]> = {};
    events.forEach((event) => {
      if (!grouped[event.session_id]) {
        grouped[event.session_id] = [];
      }
      grouped[event.session_id].push(event);
    });

    Object.keys(grouped).forEach((sid) => {
      grouped[sid].sort((a, b) => {
        const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      });
    });

    return grouped;
  }, [events]);

  useEffect(() => {
    const supabase = createClient();
    isMountedRef.current = true;

    const initialize = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !isMountedRef.current) return;

      try {
        let activeSiteIds: string[] = [];

        if (siteId) {
          const { data: site } = await supabase
            .from('sites')
            .select('id')
            .eq('id', siteId)
            .single();

          if (!site || !isMountedRef.current) {
            setError('Site access denied');
            setIsLoading(false);
            return;
          }
          activeSiteIds = [siteId];
        } else {
          const { data: sites } = await supabase
            .from('sites')
            .select('id')
            .eq('user_id', user.id);

          if (!sites || sites.length === 0) {
            setIsInitialized(true);
            setIsLoading(false);
            return;
          }
          activeSiteIds = sites.map((s) => s.id);
        }

        if (!isMountedRef.current) return;
        setUserSites(activeSiteIds);
        setIsInitialized(true);

        const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

        const { data: recentEvents, error: eventsError } = await supabase
          .from('events')
          .select('*, sessions!inner(site_id), url')
          .eq('session_month', currentMonth)
          // Strict site scope for /dashboard/site/[siteId]
          .eq('sessions.site_id', siteId || '')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(100);

        if (!isMountedRef.current) return;

        if (eventsError) throw eventsError;

        if (recentEvents) {
          const eventsData = recentEvents.map((item: any) => ({
            id: item.id,
            session_id: item.session_id,
            session_month: item.session_month,
            event_category: item.event_category,
            event_action: item.event_action,
            event_label: item.event_label,
            event_value: item.event_value,
            metadata: item.metadata || {},
            created_at: item.created_at,
            url: item.url,
          })) as Event[];

          setEvents(eventsData);
        }
      } catch (err: unknown) {
        console.error('[LIVE_FEED] Init error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to load feed';
        setError(errorMessage);
      } finally {
        if (isMountedRef.current) setIsLoading(false);
      }
    };

    initialize();

    return () => {
      isMountedRef.current = false;
    };
  }, [siteId]);

  // Realtime subscription
  useEffect(() => {
    if (!isInitialized || userSites.length === 0) return;

    const supabase = createClient();
    const siteIds = siteId ? [siteId] : [...userSites];

    if (subscriptionRef.current) {
      if (!duplicateWarningRef.current) {
        console.warn('[LIVE_FEED] Duplicate subscription protection');
        duplicateWarningRef.current = true;
      }
      supabase.removeChannel(subscriptionRef.current);
    }

    const channelName = `events-realtime-${siteIds.join('-')}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        (payload) => {
          if (!isMountedRef.current) return;
          const newEvent = payload.new as Event;
          const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

          if (newEvent.session_month !== currentMonth) return;

          setEvents((prev) => [newEvent, ...prev].slice(0, 100));
        }
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [isInitialized, userSites, siteId]);

  // Extract unique filter values from sessions
  const filterOptions = useMemo(() => {
    const cities = new Set<string>();
    const districts = new Set<string>();
    const devices = new Set<string>();

    Object.values(groupedSessions).forEach((sessionEvents) => {
      if (sessionEvents.length > 0) {
        const metadata = (sessionEvents[sessionEvents.length - 1]?.metadata || {}) as any;
        if (metadata.city && metadata.city !== 'Unknown') cities.add(metadata.city);
        if (metadata.district) districts.add(metadata.district);
        if (metadata.device_type) devices.add(metadata.device_type);
      }
    });

    return {
      cities: Array.from(cities).sort(),
      districts: Array.from(districts).sort(),
      devices: Array.from(devices).sort(),
    };
  }, [groupedSessions]);

  const displayedRows = useMemo(() => {
    let rows = activityRows;
    if (!adsOnly && (selectedCity || selectedDistrict || selectedDevice)) {
      rows = rows.filter((e) => {
        const md = (e.metadata || {}) as any;
        if (selectedCity && md.city !== selectedCity) return false;
        if (selectedDistrict && md.district !== selectedDistrict) return false;
        if (selectedDevice && md.device_type !== selectedDevice) return false;
        return true;
      });
    }
    return rows;
  }, [activityRows, adsOnly, selectedCity, selectedDistrict, selectedDevice]);

  const hasActiveFilters = !!(selectedCity || selectedDistrict || selectedDevice);
  const clearFilters = () => {
    setSelectedCity(null);
    setSelectedDistrict(null);
    setSelectedDevice(null);
  };

  if (isInitialized && userSites.length === 0) {
    return (
      <Card className="bg-white border border-slate-200 border-2 border-dashed shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-mono text-slate-900">⚠️ NO SITES CONFIGURED</CardTitle>
          <CardDescription className="text-xs font-mono text-slate-600 mt-2 uppercase">
            Onboarding required
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-slate-600 font-mono text-sm mb-4">
            You need to create a site first to track events.
          </p>
          <a href="/dashboard" className="text-emerald-600 hover:text-emerald-700 font-mono text-sm underline uppercase tracking-tighter">
            &rarr; Go to Dashboard
          </a>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0 && isInitialized && !isLoading) {
    return (
      <Card className="bg-white border border-slate-200 shadow-sm">
        <CardHeader className="pb-3 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-mono text-slate-900">
              LIVE STREAM
              {adsOnly && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-xs font-mono text-amber-700 uppercase tracking-widest">
                  ADS-ONLY
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-xs font-mono text-emerald-600 uppercase">Listening</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-12 flex flex-col items-center group">
          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-4 border border-slate-200 group-hover:border-slate-300 transition-colors">
            <Activity className="w-5 h-5 text-slate-600 group-hover:text-slate-700 transition-colors" />
          </div>
          <p className="text-slate-600 font-mono text-sm uppercase tracking-widest mb-1">No sessions yet</p>
          <p className="text-slate-600 font-mono text-xs italic">
            Real-time stream active • Events will appear here
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
    <Card className="bg-background text-foreground border border-border shadow-sm">
      <CardHeader className="pb-3 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-mono text-slate-900 tracking-tight">
              LIVE STREAM
              {adsOnly && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-xs font-mono text-amber-700 uppercase tracking-widest">
                  ADS-ONLY
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground mt-1 uppercase tracking-wider">
              {events.length} events
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-xs font-mono text-emerald-600">LIVE</span>
          </div>
        </div>
      </CardHeader>

      {error && !isLoading && (
        <div className="px-6 py-2 border-b border-rose-200 bg-rose-50">
          <div className="text-xs text-rose-700 font-mono flex items-center gap-2">
            <span className="uppercase font-bold">Error:</span> {error}
          </div>
        </div>
      )}

      <CardContent className="pt-4">
        {isLoading ? (
          <div className="py-10 text-center font-mono text-sm text-slate-600 uppercase animate-pulse">
            Synchronizing stream...
          </div>
        ) : (
          <>
            {!adsOnly && (filterOptions.cities.length > 0 || filterOptions.districts.length > 0 || filterOptions.devices.length > 0) && (
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm mb-4 pb-3 border-b border-slate-200 -mx-6 px-6 pt-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {filterOptions.cities.length > 0 && (
                    <select
                      value={selectedCity || ''}
                      onChange={(e) => setSelectedCity(e.target.value || null)}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-700 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    >
                      <option value="">All Cities</option>
                      {filterOptions.cities.map((city) => (
                        <option key={city} value={city}>{city}</option>
                      ))}
                    </select>
                  )}
                  {filterOptions.districts.length > 0 && (
                    <select
                      value={selectedDistrict || ''}
                      onChange={(e) => setSelectedDistrict(e.target.value || null)}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-700 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    >
                      <option value="">All Districts</option>
                      {filterOptions.districts.map((district) => (
                        <option key={district} value={district}>{district}</option>
                      ))}
                    </select>
                  )}
                  {filterOptions.devices.length > 0 && (
                    <select
                      value={selectedDevice || ''}
                      onChange={(e) => setSelectedDevice(e.target.value || null)}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-700 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    >
                      <option value="">All Devices</option>
                      {filterOptions.devices.map((device) => (
                        <option key={device} value={device}>{device}</option>
                      ))}
                    </select>
                  )}
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-slate-600 font-mono text-xs transition-colors uppercase"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="max-h-[520px] overflow-y-auto">
              {displayedRows.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {hasActiveFilters ? 'No matches found' : 'No events yet.'}
                </div>
              ) : (
                <ol className="divide-y divide-border">
                  {displayedRows.map((e) => {
                    const md = (e.metadata || {}) as any;
                    const c = classify(e);
                    const Icon = c.Icon;
                    const time = new Date(e.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                    const city = md?.city ? String(md.city) : null;
                    const device = md?.device_type ? String(md.device_type) : null;
                    const urlPath = e.url
                      ? (() => { try { return new URL(e.url).pathname || '/'; } catch { return e.url; } })()
                      : null;
                    const headline =
                      c.label === 'Phone'
                        ? `Phone activity${city ? ` • ${city}` : ''}`
                        : c.label === 'WhatsApp'
                          ? `WhatsApp activity${city ? ` • ${city}` : ''}`
                          : c.label === 'Form'
                            ? `Form submit${city ? ` • ${city}` : ''}`
                            : c.label === 'Ads'
                              ? `Ad click / acquisition${city ? ` • ${city}` : ''}`
                              : `${e.event_category}: ${e.event_action}`;

                    return (
                      <li key={e.id} className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="w-14 text-sm tabular-nums text-muted-foreground">{time}</div>
                          <div className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full ${c.iconBg}`}>
                            <Icon className={`${c.iconColor} h-4 w-4`} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="text-sm font-medium truncate">{headline}</div>
                              <Badge className={`${c.badgeClass} shrink-0`}>{c.label}</Badge>
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground truncate">
                              {urlPath || (device ? `Device: ${device}` : '—')}
                            </div>
                          </div>
                          <Tooltip>
                            <TooltipTrigger>
                              <Button variant="outline" size="sm" className="h-9">
                                Details
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[320px]">
                              <div className="text-sm space-y-1">
                                <div className="tabular-nums">Session: {e.session_id.slice(0, 8)}…</div>
                                {device && <div>Device: {device}</div>}
                                {city && <div>City: {city}</div>}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}
