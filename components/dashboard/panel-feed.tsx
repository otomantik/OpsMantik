'use client';

import React, { useState, useMemo } from 'react';
import type { HunterIntent } from '@/lib/types/hunter';
import { HunterCard } from './hunter-card';
import { LeadActionOverlay } from './lead-action-overlay';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { createClient } from '@/lib/supabase/client';

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
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    return calls.filter(c => {
      const cDate = new Date(c.created_at).toDateString();
      if (dateFilter === 'today') return cDate === todayStr;
      if (dateFilter === 'yesterday') return cDate === yesterdayStr;
      return true;
    });
  }, [calls, dateFilter]);

  // FOCUS MODE: The "Active" intent is the first one in the filtered list
  const activeIntent = filteredCalls[0];

  const handleAction = async (id: string, score: number, phone?: string) => {
    // 1. OPTIMISTIC UPDATE: Remove lead from UI immediately for zero-lag feeling
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
      // ROLLBACK: If API fails, restore the lead and notify user
      setCalls(previousCalls);
      // Note: We don't restore selectedIntent to avoid loop, user just sees the card return
      alert(t('toast.failedUpdate'));
    }
  };

  // 2. REALTIME ENGINE: Listen for new leads and status updates
  React.useEffect(() => {
    const supabase = createClient();
    
    const channel = supabase
      .channel('public:calls')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'calls' },
        (payload) => {
          const newCall = payload.new as HunterIntent;
          // Security/Consistency check: Only inject if it belongs to local state logic (dates etc)
          setCalls(prev => {
            if (prev.some(c => c.id === newCall.id)) return prev;
            // Place new calls at the top of the deck
            return [newCall, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calls' },
        (payload) => {
          const updated = payload.new as HunterIntent;
          // If a call is confirmed/junked elsewhere, remove it from this operator's deck
          if (updated.status === 'confirmed' || updated.status === 'junk') {
            setCalls(prev => prev.filter(c => c.id !== updated.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
       {/* Date Filter Bar - Global Feel */}
       <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 p-1.5 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
             <button 
                onClick={() => setDateFilter('today')}
                className={cn(
                  "px-6 py-2.5 text-[10px] font-black rounded-xl transition-all duration-300 uppercase tracking-widest",
                   dateFilter === 'today' ? "bg-slate-900 text-white shadow-[0_10px_20px_rgba(0,0,0,0.15)] ring-1 ring-slate-900/5" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                )}
             >
                {t('date.today')}
             </button>
             <button 
                onClick={() => setDateFilter('yesterday')}
                className={cn(
                  "px-6 py-2.5 text-[10px] font-black rounded-xl transition-all duration-300 uppercase tracking-widest",
                   dateFilter === 'yesterday' ? "bg-slate-900 text-white shadow-[0_10px_20px_rgba(0,0,0,0.15)] ring-1 ring-slate-900/5" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                )}
             >
                {t('date.yesterday')}
             </button>
             <button 
                onClick={() => setDateFilter('all')}
                className={cn(
                  "px-6 py-2.5 text-[10px] font-black rounded-xl transition-all duration-300 uppercase tracking-widest",
                   dateFilter === 'all' ? "bg-slate-900 text-white shadow-[0_10px_20px_rgba(0,0,0,0.15)] ring-1 ring-slate-900/5" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                )}
             >
                {t('ociControl.allStatuses')}
             </button>
          </div>
          <div className="w-10 h-10 rounded-full border border-slate-200 bg-white flex items-center justify-center text-slate-300">
             <Calendar size={18} />
          </div>
       </div>

       <div className="min-h-[400px]">
         {!activeIntent ? (
            <div className="flex flex-col items-center justify-center p-20 text-center border border-slate-200/60 rounded-[4rem] bg-white shadow-[0_30px_60px_-15px_rgba(0,0,0,0.05)] animate-in zoom-in-95 duration-700">
               <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center text-5xl mb-8 shadow-inner ring-8 ring-emerald-50/50">🎉</div>
               <h3 className="text-3xl font-black text-slate-900 tracking-tight">{t('empty.queueMissionAccomplished')}</h3>
               <p className="text-slate-400 font-bold mt-3 text-[11px] uppercase tracking-[0.3em] max-w-[240px] leading-relaxed">{t('empty.noDataTodayDesc')}</p>
            </div>
         ) : (
            <div className="space-y-6">
               <div className="relative group">
                  <div className="absolute -inset-4 bg-blue-500/5 rounded-[4rem] blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
                  <div className="relative">
                    <HunterCard 
                      intent={activeIntent}
                      onSeal={() => setSelectedIntent(activeIntent)}
                      onJunk={({ id }) => handleAction(id, 0)}
                      onSkip={({ id }) => setCalls(prev => prev.filter(c => c.id !== id))}
                      onQualify={({ score }) => handleAction(activeIntent.id, score)}
                    />
                  </div>
               </div>

               {/* Hint for more */}
               {filteredCalls.length > 1 && (
                 <div className="flex items-center justify-center gap-3 py-4">
                    <div className="h-px w-10 bg-slate-200" />
                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">
                       {t('session.eventCount', { count: filteredCalls.length - 1 })} {t('common.more')}
                    </span>
                    <div className="h-px w-10 bg-slate-200" />
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
