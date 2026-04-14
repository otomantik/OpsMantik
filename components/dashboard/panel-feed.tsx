'use client';

import React, { useState, useMemo } from 'react';
import type { HunterIntent } from '@/lib/types/hunter';
import { HunterCard } from './hunter-card';
import { LeadActionOverlay } from './lead-action-overlay';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { createClient } from '@/lib/supabase/client';
import { ChevronDown } from 'lucide-react';

export function PanelFeed({
  initialCalls
}: {
  initialCalls: HunterIntent[];
}) {
  const { t } = useTranslation();
  const [calls, setCalls] = useState(initialCalls);
  const [selectedIntent, setSelectedIntent] = useState<HunterIntent | null>(null);
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'all'>('today');

  const filteredCalls = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    return calls.filter(c => {
      if (dateFilter === 'all') return true;
      const cDate = new Date(c.created_at).toDateString();
      const s = (c.status || '').toLowerCase();
      const isPending = !['confirmed', 'junk', 'g_trash'].includes(s);
      if (dateFilter === 'today') return cDate === todayStr && isPending;
      if (dateFilter === 'yesterday') return cDate === yesterdayStr && isPending;
      return true;
    });
  }, [calls, dateFilter]);

  const activeIntent = filteredCalls[0];
  const queueCount = filteredCalls.length;

  const handleAction = async (id: string, score: number, phone?: string) => {
    const previousCalls = [...calls];
    setCalls(prev => prev.filter(c => c.id !== id));
    setSelectedIntent(null);

    try {
      const res = await fetch(`/api/intents/${id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, score })
      });
      if (!res.ok) throw new Error('API Error');
    } catch (err) {
      console.error('Action failed:', err);
      setCalls(previousCalls);
      alert(t('toast.failedUpdate'));
    }
  };

  // Realtime engine
  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('public:calls')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, (payload) => {
        const newCall = payload.new as HunterIntent;
        setCalls(prev => {
          if (prev.some(c => c.id === newCall.id)) return prev;
          return [newCall, ...prev];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, (payload) => {
        const updated = payload.new as HunterIntent;
        if (updated.status === 'confirmed' || updated.status === 'junk') {
          setCalls(prev => prev.filter(c => c.id !== updated.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const filters = [
    { key: 'today' as const, label: t('date.today') },
    { key: 'yesterday' as const, label: t('date.yesterday') },
    { key: 'all' as const, label: t('ociControl.allStatuses') },
  ];

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Filter Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-1 bg-slate-800/60 border border-slate-700/60 rounded-lg">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setDateFilter(f.key)}
              className={cn(
                'px-4 py-1.5 text-[10px] font-black rounded-md transition-all duration-200 uppercase tracking-widest',
                dateFilter === f.key
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Queue depth indicator */}
        {queueCount > 0 && (
          <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {queueCount} {queueCount === 1 ? 'intent' : 'intents'}
          </div>
        )}
      </div>

      {/* Card or Empty */}
      <div className="min-h-[300px]">
        {!activeIntent ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-slate-800 bg-slate-900/60 text-center animate-in zoom-in-95 duration-500">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-3xl mb-5">
              {dateFilter === 'all' ? '🔍' : '✓'}
            </div>
            <h3 className="text-base font-black text-slate-200 tracking-tight">
              {dateFilter === 'today'
                ? t('queue.emptyTodayTitle')
                : dateFilter === 'yesterday'
                  ? t('queue.emptyYesterdayTitle')
                  : t('common.noResults')}
            </h3>
            <p className="text-[11px] font-medium text-slate-600 mt-2 max-w-[220px] leading-relaxed uppercase tracking-wider">
              {dateFilter === 'today'
                ? t('queue.emptyTodaySubtitle')
                : dateFilter === 'yesterday'
                  ? t('queue.emptyYesterdaySubtitle')
                  : '—'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <HunterCard
              intent={activeIntent}
              onSeal={() => setSelectedIntent(activeIntent)}
              onJunk={({ id }) => handleAction(id, 0)}
              onSkip={({ id }) => setCalls(prev => prev.filter(c => c.id !== id))}
              onQualify={({ score }) => handleAction(activeIntent.id, score)}
            />

            {/* Queue depth hint */}
            {queueCount > 1 && (
              <div className="flex items-center justify-center gap-2 py-2">
                <ChevronDown className="h-3 w-3 text-slate-600" />
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                  {queueCount - 1} more in queue
                </span>
                <ChevronDown className="h-3 w-3 text-slate-600" />
              </div>
            )}
          </div>
        )}
      </div>

      <LeadActionOverlay
        intent={selectedIntent as HunterIntent}
        isOpen={!!selectedIntent}
        onClose={() => setSelectedIntent(null)}
        onComplete={async (phone, score) => {
          if (selectedIntent) {
            await handleAction(selectedIntent.id, score || 100, phone);
          }
        }}
      />
    </div>
  );
}
