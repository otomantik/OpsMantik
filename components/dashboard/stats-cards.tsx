'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function StatsCards() {
  const [stats, setStats] = useState({
    sessions: 0,
    events: 0,
    avgLeadScore: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      // Get user's sites
      const { data: sites } = await supabase
        .from('sites')
        .select('id')
        .eq('user_id', user.id);

      if (!sites || sites.length === 0) return;

      const siteIds = sites.map(s => s.id);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

      // Get sessions count - RLS compliant
      // Count unique sessions from events (if event exists, session exists)
      // This ensures RLS compliance through the JOIN pattern
      const { data: eventsData } = await supabase
        .from('events')
        .select('session_id, sessions!inner(site_id)')
        .gte('created_at', thirtyDaysAgo.toISOString());

      // Count unique sessions that belong to user's sites
      const uniqueSessionIds = new Set<string>();
      if (eventsData) {
        eventsData.forEach((item: any) => {
          if (item.session_id && item.sessions?.site_id && siteIds.includes(item.sessions.site_id)) {
            uniqueSessionIds.add(item.session_id);
          }
        });
      }
      const sessionsCount = uniqueSessionIds.size;

      // Get events count - RLS compliant using JOIN pattern
      const { count: eventsCount } = await supabase
        .from('events')
        .select('*, sessions!inner(site_id)', { count: 'exact', head: true })
        .eq('session_month', currentMonth)
        .gte('created_at', thirtyDaysAgo.toISOString());

      // Get average lead score - RLS compliant using JOIN pattern
      const { data: events } = await supabase
        .from('events')
        .select('metadata, sessions!inner(site_id)')
        .eq('session_month', currentMonth)
        .gte('created_at', thirtyDaysAgo.toISOString());

      const scores = events?.map(e => (e.metadata as any)?.lead_score || 0).filter(s => s > 0) || [];
      const avgScore = scores.length > 0 
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

      setStats({
        sessions: sessionsCount || 0,
        events: eventsCount || 0,
        avgLeadScore: avgScore,
      });
    };

    fetchStats();
    const interval = setInterval(fetchStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Sessions - Emerald Neon */}
      <Card className="glass border-slate-800/50 neon-emerald">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-slate-300 uppercase tracking-wider">
            Sessions
          </CardTitle>
          <CardDescription className="text-xs font-mono text-slate-500 mt-1">
            Last 30 days
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <p className="text-4xl font-bold font-mono text-emerald-400 mb-1">
            {stats.sessions.toLocaleString()}
          </p>
          <p className="text-xs font-mono text-slate-500">Unique visitors</p>
        </CardContent>
      </Card>

      {/* Events - Blue Neon */}
      <Card className="glass border-slate-800/50 neon-blue">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-slate-300 uppercase tracking-wider">
            Events
          </CardTitle>
          <CardDescription className="text-xs font-mono text-slate-500 mt-1">
            Last 30 days
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <p className="text-4xl font-bold font-mono text-blue-400 mb-1">
            {stats.events.toLocaleString()}
          </p>
          <p className="text-xs font-mono text-slate-500">Total tracked</p>
        </CardContent>
      </Card>

      {/* Lead Score - Rose Neon */}
      <Card className="glass border-slate-800/50 neon-rose">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-slate-300 uppercase tracking-wider">
            Lead Score
          </CardTitle>
          <CardDescription className="text-xs font-mono text-slate-500 mt-1">
            Average
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <p className="text-4xl font-bold font-mono text-rose-400 mb-1">
            {stats.avgLeadScore}
          </p>
          <p className="text-xs font-mono text-slate-500">Out of 100</p>
        </CardContent>
      </Card>

      {/* Status Indicator */}
      <Card className="glass border-slate-800/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-slate-300 uppercase tracking-wider">
            Status
          </CardTitle>
          <CardDescription className="text-xs font-mono text-slate-500 mt-1">
            System
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></div>
            <p className="text-lg font-mono font-bold text-emerald-400">ONLINE</p>
          </div>
          <p className="text-xs font-mono text-slate-500">Real-time active</p>
        </CardContent>
      </Card>
    </div>
  );
}
