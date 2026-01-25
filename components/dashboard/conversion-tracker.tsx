'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Phone, TrendingUp } from 'lucide-react';

interface Conversion {
  session_id: string;
  event_action: string;
  event_label: string | null;
  created_at: string;
  lead_score: number;
  phone_matched: boolean;
  phone_number: string | null;
}

interface ConversionTrackerProps {
  siteId?: string;
}

export function ConversionTracker({ siteId }: ConversionTrackerProps = {}) {
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchConversions = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

      // If siteId is provided, filter by it directly (RLS will enforce access)
      let eventsQuery = supabase
        .from('events')
        .select('session_id, event_action, event_label, created_at, metadata, sessions!inner(site_id)')
        .eq('session_month', currentMonth)
        .eq('event_category', 'conversion');

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
        .limit(50);

      if (events) {
        // Get matched calls for these sessions
        const sessionIds = [...new Set(events.map((e: any) => e.session_id))];
        const { data: calls } = await supabase
          .from('calls')
          .select('matched_session_id, phone_number')
          .in('matched_session_id', sessionIds);

        const callsMap = new Map(
          calls?.map(c => [c.matched_session_id, c.phone_number]) || []
        );

        const conversionsData = events.map((event: any) => ({
          session_id: event.session_id,
          event_action: event.event_action,
          event_label: event.event_label,
          created_at: event.created_at,
          lead_score: event.metadata?.lead_score || 0,
          phone_matched: callsMap.has(event.session_id),
          phone_number: callsMap.get(event.session_id) || null,
        })) as Conversion[];

        setConversions(conversionsData);
      }

      setIsLoading(false);
    };

    fetchConversions();
    const interval = setInterval(fetchConversions, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [siteId]);

  return (
    <Card className="glass border-slate-800/50">
      <CardHeader>
        <CardTitle className="text-lg font-mono text-slate-200">DÖNÜŞÜMLER</CardTitle>
        <CardDescription className="font-mono text-xs text-slate-400 mt-1">
          {conversions.length} conversion{conversions.length !== 1 ? 's' : ''} • Phone matches
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-slate-500 font-mono text-sm">Loading...</p>
        ) : conversions.length === 0 ? (
          <p className="text-slate-500 font-mono text-sm">No conversions yet</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {conversions.map((conv, index) => (
              <div
                key={`${conv.session_id}-${index}`}
                className="p-3 rounded bg-slate-800/30 border border-slate-700/30"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="font-mono text-sm text-slate-200 font-semibold">
                        {conv.event_action}
                      </span>
                    </div>
                    {conv.event_label && (
                      <p className="font-mono text-xs text-slate-400 mt-1">
                        {conv.event_label}
                      </p>
                    )}
                    <p className="font-mono text-[10px] text-slate-500 mt-1">
                      Session: {conv.session_id.slice(0, 8)}...
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold text-emerald-400">
                      Score: {conv.lead_score}
                    </p>
                  </div>
                </div>
                
                {conv.phone_matched && conv.phone_number && (
                  <div className="mt-2 p-2 rounded bg-rose-500/10 border border-rose-500/30 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-rose-400" />
                    <div>
                      <p className="font-mono text-xs text-rose-400 font-semibold">
                        📞 TELEFON EŞLEŞTİ
                      </p>
                      <p className="font-mono text-sm text-rose-300">
                        {conv.phone_number}
                      </p>
                    </div>
                  </div>
                )}
                
                <p className="font-mono text-[10px] text-slate-600 mt-2">
                  {new Date(conv.created_at).toLocaleString('tr-TR')}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
