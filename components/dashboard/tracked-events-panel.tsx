'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface EventType {
  category: string;
  action: string;
  count: number;
  lastSeen: string;
}

interface TrackedEventsPanelProps {
  siteId?: string;
}

export function TrackedEventsPanel({ siteId }: TrackedEventsPanelProps = {}) {
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchEventTypes = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

      // If siteId is provided, filter by it directly (RLS will enforce access)
      let eventsQuery = supabase
        .from('events')
        .select('event_category, event_action, created_at, sessions!inner(site_id)')
        .eq('session_month', currentMonth);

      if (siteId) {
        // Filter by specific site
        eventsQuery = eventsQuery.eq('sessions.site_id', siteId);
      } else {
        // Get user's sites and filter
        const { data: sites } = await supabase
          .from('sites')
          .select('id')
          .eq('user_id', user.id);

        if (!sites || sites.length === 0) {
          setIsLoading(false);
          return;
        }

        const siteIds = sites.map(s => s.id);
        eventsQuery = eventsQuery.in('sessions.site_id', siteIds);
      }

      const { data: events } = await eventsQuery
        .order('created_at', { ascending: false })
        .limit(1000);

      if (events) {
        // Group by category + action
        const grouped: Record<string, EventType> = {};
        let total = 0;

        events.forEach((event: any) => {
          const key = `${event.event_category}:${event.event_action}`;
          if (!grouped[key]) {
            grouped[key] = {
              category: event.event_category,
              action: event.event_action,
              count: 0,
              lastSeen: event.created_at,
            };
          }
          grouped[key].count++;
          total++;
          if (new Date(event.created_at) > new Date(grouped[key].lastSeen)) {
            grouped[key].lastSeen = event.created_at;
          }
        });

        const sorted = Object.values(grouped)
          .sort((a, b) => b.count - a.count)
          .slice(0, 20);

        setEventTypes(sorted);
        setTotalEvents(total);
      }

      setIsLoading(false);
    };

    fetchEventTypes();
    const interval = setInterval(fetchEventTypes, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'conversion':
        return 'text-emerald-400';
      case 'acquisition':
        return 'text-blue-400';
      case 'interaction':
        return 'text-yellow-400';
      default:
        return 'text-slate-400';
    }
  };

  return (
    <Card className="glass border-slate-800/50">
      <CardHeader>
        <CardTitle className="text-lg font-mono text-slate-200">TRACKED EVENTS</CardTitle>
        <CardDescription className="font-mono text-xs text-slate-400 mt-1">
          {totalEvents} total events • {eventTypes.length} unique types
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-slate-500 font-mono text-sm">Loading...</p>
        ) : eventTypes.length === 0 ? (
          <p className="text-slate-500 font-mono text-sm">No events tracked yet</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {eventTypes.map((eventType, index) => (
              <div
                key={`${eventType.category}-${eventType.action}`}
                className="flex items-center justify-between p-2 rounded bg-slate-800/30 border border-slate-700/30"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-xs font-semibold ${getCategoryColor(eventType.category)}`}>
                      {eventType.category.toUpperCase()}
                    </span>
                    <span className="font-mono text-xs text-slate-300">
                      {eventType.action}
                    </span>
                  </div>
                  <p className="font-mono text-[10px] text-slate-500 mt-0.5">
                    Last: {new Date(eventType.lastSeen).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="font-mono text-lg font-bold text-slate-200">
                    {eventType.count}
                  </p>
                  <p className="font-mono text-[10px] text-slate-500">
                    times
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
