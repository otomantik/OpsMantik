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
import { SessionGroup } from './session-group';
import { isDebugEnabled } from '@/lib/utils';
import { Activity } from 'lucide-react';
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
}

export function LiveFeed({ siteId }: LiveFeedProps = {}) {
  const [events, setEvents] = useState<Event[]>([]);
  const [userSites, setUserSites] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const subscriptionRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const duplicateWarningRef = useRef<boolean>(false);

  // Filter state
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

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

  // Memoize filtered session list
  const displayedSessions = useMemo(() => {
    let filtered = Object.entries(groupedSessions);

    if (selectedCity || selectedDistrict || selectedDevice) {
      filtered = filtered.filter(([, sessionEvents]) => {
        if (sessionEvents.length === 0) return false;
        const metadata = (sessionEvents[sessionEvents.length - 1]?.metadata || {}) as any;

        if (selectedCity && metadata.city !== selectedCity) return false;
        if (selectedDistrict && metadata.district !== selectedDistrict) return false;
        if (selectedDevice && metadata.device_type !== selectedDevice) return false;

        return true;
      });
    }

    return filtered.slice(0, 10);
  }, [groupedSessions, selectedCity, selectedDistrict, selectedDevice]);

  const hasActiveFilters = !!(selectedCity || selectedDistrict || selectedDevice);
  const clearFilters = () => {
    setSelectedCity(null);
    setSelectedDistrict(null);
    setSelectedDevice(null);
  };

  if (isInitialized && userSites.length === 0) {
    return (
      <Card className="glass border-slate-800/50 border-2 border-dashed">
        <CardHeader>
          <CardTitle className="text-sm font-mono text-slate-200">⚠️ NO SITES CONFIGURED</CardTitle>
          <CardDescription className="text-[10px] font-mono text-slate-500 mt-2 uppercase">
            Onboarding required
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-slate-400 font-mono text-xs mb-4">
            You need to create a site first to track events.
          </p>
          <a href="/dashboard" className="text-emerald-400 hover:text-emerald-300 font-mono text-[10px] underline uppercase tracking-tighter">
            &rarr; Go to Dashboard
          </a>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0 && isInitialized && !isLoading) {
    return (
      <Card className="glass border-slate-800/50">
        <CardHeader className="pb-3 border-b border-slate-800/20">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-mono text-slate-200">LIVE EVENT FEED</CardTitle>
            <div className="flex items-center gap-1.5 opacity-80 no-emerald-glow">
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.4)]"></div>
              <span className="text-[9px] font-mono text-emerald-400 uppercase">Listening</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-12 flex flex-col items-center group">
          <div className="w-12 h-12 bg-slate-800/20 rounded-full flex items-center justify-center mb-4 border border-slate-800/50 group-hover:border-slate-700/60 transition-colors">
            <Activity className="w-5 h-5 text-slate-600 group-hover:text-slate-500 transition-colors" />
          </div>
          <p className="text-slate-400 font-mono text-xs uppercase tracking-widest mb-1">No sessions yet</p>
          <p className="text-slate-600 font-mono text-[10px] italic">
            Real-time stream active • Events will appear here
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass border-slate-800/50">
      <CardHeader className="pb-3 border-b border-slate-800/20">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-mono text-slate-200 tracking-tight">LIVE EVENT FEED</CardTitle>
            <CardDescription className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-wider">
              {events.length} events &bull; {Object.keys(groupedSessions).length} sessions
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5 opacity-80 no-emerald-glow">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.4)]"></div>
            <span className="text-[9px] font-mono text-emerald-400">LIVE</span>
          </div>
        </div>
      </CardHeader>

      {error && !isLoading && (
        <div className="px-6 py-2 border-b border-rose-500/20 bg-rose-500/5">
          <div className="text-[10px] text-rose-400 font-mono flex items-center gap-2">
            <span className="uppercase font-bold">Error:</span> {error}
          </div>
        </div>
      )}

      <CardContent className="pt-4">
        {isLoading ? (
          <div className="py-10 text-center font-mono text-[10px] text-slate-600 uppercase animate-pulse">
            Synchronizing stream...
          </div>
        ) : (
          <>
            {(filterOptions.cities.length > 0 || filterOptions.districts.length > 0 || filterOptions.devices.length > 0) && (
              <div className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-md mb-4 pb-3 border-b border-slate-800/30 -mx-6 px-6 pt-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {filterOptions.cities.length > 0 && (
                    <select
                      value={selectedCity || ''}
                      onChange={(e) => setSelectedCity(e.target.value || null)}
                      className="px-2 py-1 bg-slate-800/50 border border-slate-700/50 rounded text-slate-300 font-mono text-[10px] focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
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
                      className="px-2 py-1 bg-slate-800/50 border border-slate-700/50 rounded text-slate-300 font-mono text-[10px] focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
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
                      className="px-2 py-1 bg-slate-800/50 border border-slate-700/50 rounded text-slate-300 font-mono text-[10px] focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
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
                      className="px-2 py-1 bg-slate-700/30 hover:bg-slate-700/60 border border-slate-600/50 rounded text-slate-400 font-mono text-[9px] transition-colors uppercase"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-4 max-h-[600px] overflow-y-auto relative pr-1 custom-scrollbar">
              {displayedSessions.length === 0 ? (
                <p className="text-slate-500 font-mono text-[11px] text-center py-10 uppercase tracking-widest opacity-50">
                  {hasActiveFilters ? 'No matches found' : 'No sessions found'}
                </p>
              ) : (
                displayedSessions.map(([sid, sessionEvents]) => (
                  <SessionGroup
                    key={sid}
                    siteId={siteId}
                    sessionId={sid}
                    events={sessionEvents}
                  />
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
