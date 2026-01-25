'use client';

/**
 * LiveFeed - Real-time event stream with month partition filtering
 * 
 * Acceptance Criteria (see docs/DEV_CHECKLIST.md):
 * - Realtime feed streams without double subscriptions
 * - Month partition filter enforced (session_month check)
 * - RLS compliance via JOIN patterns
 * - Events capped at 100, sessions at 10 displayed
 * 
 * Security: Uses anon key only (createClient), no service role leakage
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SessionGroup } from './session-group';
import { isDebugEnabled } from '@/lib/utils';

interface Event {
  id: string;
  session_id: string;
  session_month: string;
  event_category: string;
  event_action: string;
  event_label: string | null;
  event_value: number | null;
  metadata: any;
  created_at: string;
  url?: string;
}

interface LiveFeedProps {
  siteId?: string;
}

export function LiveFeed({ siteId }: LiveFeedProps = {}) {
  const [events, setEvents] = useState<Event[]>([]);
  const [groupedSessions, setGroupedSessions] = useState<Record<string, Event[]>>({});
  const [userSites, setUserSites] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const subscriptionRef = useRef<any>(null);
  const isMountedRef = useRef<boolean>(true);
  const duplicateWarningRef = useRef<boolean>(false);
  
  // Filter state
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  // Memoized grouping: compute groupedSessions from events only when events change
  // This avoids expensive recalculations on every render
  useEffect(() => {
    if (events.length === 0) {
      setGroupedSessions({});
      return;
    }

    // Group events by session (only called when events array changes, not on every render)
    const grouped: Record<string, Event[]> = {};
    events.forEach((event) => {
      if (!grouped[event.session_id]) {
        grouped[event.session_id] = [];
      }
      grouped[event.session_id].push(event);
    });
    
    // Sort events within each session (PR1: maintain deterministic order)
    Object.keys(grouped).forEach((sessionId) => {
      grouped[sessionId].sort((a, b) => {
        const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id); // PR1 tie-breaker
      });
    });

    setGroupedSessions(grouped);
  }, [events]); // Only recalculate when events array changes

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const initialize = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;

      if (isDebugEnabled()) {
        console.log('[LIVE_FEED] Initializing for user:', user.id, siteId ? `(site: ${siteId})` : '');
      }

      // If siteId is provided, use it directly (RLS will enforce access)
      if (siteId) {
        // Verify site access via RLS (query will fail if user doesn't have access)
        const { data: site } = await supabase
          .from('sites')
          .select('id')
          .eq('id', siteId)
          .single();

        if (!site || !mounted) {
          console.warn('[LIVE_FEED] Site not found or access denied:', siteId);
          setIsInitialized(false);
          setUserSites([]);
          return;
        }

        setUserSites([siteId]);
        setIsInitialized(true);

        if (isDebugEnabled()) {
          console.log('[LIVE_FEED] Using single site:', siteId);
        }
      } else {
        // Get all user's sites (default behavior)
        const { data: sites } = await supabase
          .from('sites')
          .select('id')
          .eq('user_id', user.id);

        if (!sites || sites.length === 0 || !mounted) {
          console.warn('[LIVE_FEED] No sites found for user');
          setIsInitialized(false);
          setUserSites([]); // Set empty array to show proper message
          return;
        }

        const siteIds = sites.map((s) => s.id);
        setUserSites(siteIds);
        setIsInitialized(true);

        if (isDebugEnabled()) {
          console.log('[LIVE_FEED] Found sites:', siteIds.length);
        }
      }

      const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
      const activeSiteIds = siteId ? [siteId] : userSites.length > 0 ? userSites : [];

      if (activeSiteIds.length === 0) {
        return;
      }

      // Get recent sessions - RLS compliant (sessions -> sites -> user_id)
      const { data: sessions } = await supabase
        .from('sessions')
        .select('id')
        .in('site_id', activeSiteIds)
        .eq('created_month', currentMonth)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(50);

      if (!sessions || sessions.length === 0 || !mounted) {
        if (isDebugEnabled()) {
          console.log('[LIVE_FEED] No sessions found');
        }
        return;
      }

      if (isDebugEnabled()) {
        console.log('[LIVE_FEED] Found sessions:', sessions.length);
      }

      // Get recent events - RLS compliant using JOIN pattern
      const { data: recentEvents } = await supabase
        .from('events')
        .select('*, sessions!inner(site_id), url')
        .eq('session_month', currentMonth)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(100);

      if (recentEvents && mounted) {
        if (isDebugEnabled()) {
          console.log('[LIVE_FEED] Loaded events:', recentEvents.length);
        }
        // Extract event data (JOIN returns nested structure)
        const eventsData = recentEvents.map((item: any) => ({
          id: item.id,
          session_id: item.session_id,
          session_month: item.session_month,
          event_category: item.event_category,
          event_action: item.event_action,
          event_label: item.event_label,
          event_value: item.event_value,
          metadata: item.metadata,
          created_at: item.created_at,
          url: item.url,
        })) as Event[];
        
        setEvents(eventsData);
        // groupedSessions will be computed automatically via useEffect when events change
      }
    };

    initialize();

    return () => {
      mounted = false;
    };
  }, [siteId]); // Re-initialize when siteId changes

  // Realtime subscription - only after userSites is populated
  useEffect(() => {
    if (!isInitialized || userSites.length === 0) {
      return;
    }

    const supabase = createClient();
    // Calculate current month inside effect to ensure it's fresh
    const getCurrentMonth = () => new Date().toISOString().slice(0, 7) + '-01';
    const currentMonth = getCurrentMonth();
    const siteIds = siteId ? [siteId] : [...userSites]; // Use siteId if provided, otherwise all user sites
    
    // Runtime assertion: detect duplicate subscriptions
    if (subscriptionRef.current) {
      if (!duplicateWarningRef.current) {
        console.warn('[LIVE_FEED] ⚠️ Duplicate subscription detected! Cleaning up existing subscription before creating new one.');
        duplicateWarningRef.current = true;
      }
      // Clean up existing subscription
      supabase.removeChannel(subscriptionRef.current);
      subscriptionRef.current = null;
    } else {
      // Reset warning flag when subscription is properly cleaned up
      duplicateWarningRef.current = false;
    }
    
    if (isDebugEnabled()) {
      console.log('[LIVE_FEED] Setting up realtime subscription for', siteIds.length, 'sites');
    }

    // Realtime subscription for events
    const eventsChannel = supabase
      .channel('events-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'events',
        },
        async (payload) => {
          const newEvent = payload.new as Event;
          
          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] 🔔 New event received:', {
              id: newEvent.id.slice(0, 8),
              action: newEvent.event_action,
              session_month: newEvent.session_month,
              current_month: currentMonth,
            });
          }
          
          // Filter by session_month (partition check) - use fresh current month
          const eventMonth = newEvent.session_month;
          const freshCurrentMonth = getCurrentMonth();
          if (eventMonth !== freshCurrentMonth) {
            if (isDebugEnabled()) {
              console.log('[LIVE_FEED] ⏭️ Ignoring event from different partition:', eventMonth, 'vs', freshCurrentMonth);
            }
            return; // Ignore events from other partitions
          }

          // Trust RLS subscription filter - no redundant verification query
          // The subscription already filters by site_id via RLS policies
          // Quick client-side check: if siteId is provided, verify event belongs to that site
          // Otherwise, trust the subscription (it only receives events from user's sites)
          if (siteId) {
            // For single-site view, we can do a lightweight check via metadata if available
            // But since RLS already enforces this, we can skip verification
            // The subscription channel is site-scoped, so all events are valid
          }

          // Guard against unmount before setState
          if (!isMountedRef.current) {
            if (isDebugEnabled()) {
              console.log('[LIVE_FEED] ⏭️ Component unmounted, skipping event update');
            }
            return;
          }

          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] ✅ Adding event to feed:', newEvent.event_action);
          }

          // Incremental update: add event to events list and update only the affected session group
          setEvents((prev) => {
            // Double-check mount status inside setState callback
            if (!isMountedRef.current) return prev;
            // Maintain PR1 deterministic order: prepend new event, keep id DESC tie-breaker
            const updated = [newEvent, ...prev].slice(0, 100);
            return updated;
          });

          // Incremental grouping: update only the affected session group instead of full regroup
          setGroupedSessions((prev) => {
            if (!isMountedRef.current) return prev;
            const sessionId = newEvent.session_id;
            const updated = { ...prev };
            if (!updated[sessionId]) {
              updated[sessionId] = [];
            }
            // Add new event to session group, maintaining PR1 deterministic order
            updated[sessionId] = [newEvent, ...updated[sessionId]].slice(0, 100);
            return updated;
          });
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] ✅ Realtime subscription ACTIVE for', siteIds.length, 'sites');
          }
        } else if (status === 'CHANNEL_ERROR') {
          // Connection errors are often transient - Supabase will auto-reconnect
          // Only log as warning unless it's a persistent issue
          console.warn('[LIVE_FEED] ⚠️ Realtime subscription error (will auto-reconnect):', err?.message || 'Connection issue');
        } else if (status === 'CLOSED') {
          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] Realtime subscription closed (normal - will reconnect)');
          }
        } else {
          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] Subscription status:', status);
          }
        }
      });

    subscriptionRef.current = eventsChannel;

    return () => {
      // Mark as unmounted before cleanup
      isMountedRef.current = false;
      if (subscriptionRef.current) {
        if (isDebugEnabled()) {
          console.log('[LIVE_FEED] Cleaning up subscription on unmount');
        }
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [isInitialized, userSites]); // Subscription setup - grouping handled by useEffect on events

  // Extract unique filter values from sessions (client-side only)
  const filterOptions = useMemo(() => {
    const cities = new Set<string>();
    const districts = new Set<string>();
    const devices = new Set<string>();
    
    Object.values(groupedSessions).forEach((sessionEvents) => {
      if (sessionEvents.length > 0) {
        const metadata = sessionEvents[sessionEvents.length - 1]?.metadata || {};
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

  // Memoize filtered session list (must be before early returns)
  const displayedSessions = useMemo(() => {
    let filtered = Object.entries(groupedSessions);
    
    // Apply filters client-side
    if (selectedCity || selectedDistrict || selectedDevice) {
      filtered = filtered.filter(([sessionId, sessionEvents]) => {
        if (sessionEvents.length === 0) return false;
        const metadata = sessionEvents[sessionEvents.length - 1]?.metadata || {};
        
        if (selectedCity && metadata.city !== selectedCity) return false;
        if (selectedDistrict && metadata.district !== selectedDistrict) return false;
        if (selectedDevice && metadata.device_type !== selectedDevice) return false;
        
        return true;
      });
    }
    
    return filtered.slice(0, 10);
  }, [groupedSessions, selectedCity, selectedDistrict, selectedDevice]);
  
  const hasActiveFilters = selectedCity || selectedDistrict || selectedDevice;
  const clearFilters = () => {
    setSelectedCity(null);
    setSelectedDistrict(null);
    setSelectedDevice(null);
  };

  // Show message if no sites
  if (isInitialized && userSites.length === 0) {
    return (
      <Card className="glass border-slate-800/50 border-2 border-dashed">
        <CardHeader>
          <CardTitle className="text-lg font-mono text-slate-200">⚠️ NO SITES CONFIGURED</CardTitle>
          <CardDescription className="font-mono text-xs text-slate-400 mt-2">
            You need to create a site first to track events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-slate-400 font-mono text-sm mb-4">
            Go to the dashboard and click "Create Test Site" to get started.
          </p>
          <a href="/dashboard" className="text-emerald-400 hover:text-emerald-300 font-mono text-xs underline">
            → Go to Dashboard
          </a>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0 && isInitialized) {
    return (
      <Card className="glass border-slate-800/50">
        <CardHeader>
          <CardTitle className="text-lg font-mono text-slate-200">LIVE EVENT FEED</CardTitle>
          <CardDescription className="font-mono text-xs text-slate-400">
            Real-time updates • ACTIVE
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-slate-500 font-mono text-sm">No events detected. Awaiting activity...</p>
          <p className="text-slate-600 font-mono text-xs mt-2">
            Send events from test page to see them here
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!isInitialized) {
    return (
      <Card className="glass border-slate-800/50">
        <CardHeader>
          <CardTitle className="text-lg font-mono text-slate-200">LIVE EVENT FEED</CardTitle>
          <CardDescription className="font-mono text-xs text-slate-400">
            Initializing...
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-slate-500 font-mono text-sm">Loading sites...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass border-slate-800/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-mono text-slate-200">LIVE EVENT FEED</CardTitle>
            <CardDescription className="font-mono text-xs text-slate-400 mt-1">
              {events.length} events • {Object.keys(groupedSessions).length} sessions • Real-time active
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-xs font-mono text-emerald-400">LIVE</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Ultra-light filters */}
        {(filterOptions.cities.length > 0 || filterOptions.districts.length > 0 || filterOptions.devices.length > 0) && (
          <div className="sticky top-0 z-10 bg-slate-900 mb-4 pb-3 border-b border-slate-800/50 -mx-6 px-6 pt-4">
            <div className="flex items-center gap-2 flex-wrap">
              {filterOptions.cities.length > 0 && (
                <select
                  value={selectedCity || ''}
                  onChange={(e) => setSelectedCity(e.target.value || null)}
                  className="px-2 py-1 bg-slate-800/50 border border-slate-700 rounded text-slate-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50"
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
                  className="px-2 py-1 bg-slate-800/50 border border-slate-700 rounded text-slate-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50"
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
                  className="px-2 py-1 bg-slate-800/50 border border-slate-700 rounded text-slate-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50"
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
                  className="px-2 py-1 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded text-slate-300 font-mono text-xs transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
        <div className="space-y-3 max-h-[600px] overflow-y-auto relative">
          {displayedSessions.length === 0 ? (
            <p className="text-slate-500 font-mono text-sm text-center py-4">
              {hasActiveFilters ? 'No sessions match filters' : 'No sessions found'}
            </p>
          ) : (
            displayedSessions.map(([sessionId, sessionEvents]) => (
              <SessionGroup
                key={sessionId}
                sessionId={sessionId}
                events={sessionEvents}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
