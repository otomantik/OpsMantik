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
import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SessionGroup } from './session-group';
import { useLiveFeedData } from '@/lib/hooks/use-live-feed-data';
import { Event } from '@/lib/events';

interface LiveFeedProps {
  siteId?: string;
}

export function LiveFeed({ siteId }: LiveFeedProps = {}) {
  // Use extracted hook for data fetching and realtime subscriptions
  const { events, groupedSessions, userSites, isInitialized, isLoading, error } = useLiveFeedData(siteId);
  
  // Filter state
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);


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

  // Show error if data fetch failed
  if (error) {
    return (
      <Card className="glass border-slate-800/50 border-2 border-red-800/50">
        <CardHeader>
          <CardTitle className="text-lg font-mono text-red-400">⚠️ ERROR LOADING FEED</CardTitle>
          <CardDescription className="font-mono text-xs text-slate-400 mt-2">
            {error.message}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

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

  if (!isInitialized || isLoading) {
    return (
      <Card className="glass border-slate-800/50">
        <CardHeader>
          <CardTitle className="text-lg font-mono text-slate-200">LIVE EVENT FEED</CardTitle>
          <CardDescription className="font-mono text-xs text-slate-400">
            {isLoading ? 'Loading...' : 'Initializing...'}
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
