'use client';

import React, { useState, useMemo, useEffect } from 'react';
import type { HunterIntent } from '@/lib/types/hunter';
import { HunterCard } from './hunter-card';
import { LeadActionOverlay, type LeadActionType } from './lead-action-overlay';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { createClient } from '@/lib/supabase/client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { HelperFormPayload } from '@/lib/oci/optimization-contract';

export function PanelFeed({
  initialCalls,
  siteId,
}: {
  initialCalls: HunterIntent[];
  /** Required: scopes Realtime `calls` subscription to this site only (tenant isolation). */
  siteId: string;
}) {
  const { t } = useTranslation();
  const [calls, setCalls] = useState(initialCalls);
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'all'>('today');
  
  // Navigation & Overlay State
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ intent: HunterIntent; type: LeadActionType } | null>(null);

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

  // Reset index when filter changes
  useEffect(() => {
    setActiveIndex(0);
  }, [dateFilter]);

  const activeIntent = filteredCalls[activeIndex];
  const queueCount = filteredCalls.length;

  const handleActionComplete = async (
    actionType: LeadActionType,
    phone?: string,
    score?: number,
    helperFormPayload?: HelperFormPayload | null
  ) => {
    if (!pendingAction) {
      return { success: false, error: t('toast.failedUpdate') };
    }
    const { intent } = pendingAction;
    const intentVersion =
      typeof intent.version === 'number' && Number.isFinite(intent.version) && intent.version >= 1
        ? Math.round(intent.version)
        : null;
    if (intentVersion == null) {
      return { success: false, error: t('toast.failedUpdate') };
    }

    try {
      const res = await fetch(`/api/intents/${intent.id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          score,
          action_type: actionType,
          helper_form_payload: helperFormPayload ?? null,
          version: intentVersion,
        })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.success) {
        return {
          success: false,
          error: typeof result?.error === 'string' ? result.error : t('toast.failedUpdate'),
        };
      }

      setCalls(prev => prev.filter(c => c.id !== intent.id));
      if (activeIndex >= filteredCalls.length - 1) {
        setActiveIndex(Math.max(0, activeIndex - 1));
      }

      return { success: true };
    } catch (err) {
      console.error('Action failed:', err);
      return { success: false, error: t('toast.failedUpdate') };
    }
  };

  // Realtime engine — site-scoped channel + server filter (fail-closed tenant boundary)
  useEffect(() => {
    if (!siteId) return;

    const supabase = createClient();
    const siteFilter = `site_id=eq.${siteId}`;
    const channel = supabase
      .channel(`panel_calls_site_${siteId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'calls', filter: siteFilter },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.site_id !== siteId) return;
          const newCall = payload.new as HunterIntent;
          setCalls((prev) => {
            if (prev.some((c) => c.id === newCall.id)) return prev;
            return [newCall, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calls', filter: siteFilter },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.site_id !== siteId) return;
          const updated = payload.new as HunterIntent;
          if (updated.status === 'confirmed' || updated.status === 'junk') {
            setCalls((prev) => prev.filter((c) => c.id !== updated.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [siteId]);

  const filters = [
    { key: 'today' as const, label: t('date.today') },
    { key: 'yesterday' as const, label: t('date.yesterday') },
    { key: 'all' as const, label: t('panel.filterAllTime') },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-700 max-w-lg mx-auto pb-20">
      
      {/* ── HEADER NAVIGATION ─────────────────────────── */}
      <div className="flex items-center justify-between px-2">
        <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setDateFilter(f.key)}
              className={cn(
                'px-4 py-2 text-[10px] font-black rounded-lg transition-all uppercase tracking-widest',
                dateFilter === f.key
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">
              {queueCount} {t('common.intent')}
            </span>
        </div>
      </div>

      {/* ── CARD DECK ─────────────────────────────────── */}
      <div className="relative min-h-[500px] flex items-center justify-center">
        <AnimatePresence mode="wait">
          {!activeIntent ? (
             <motion.div 
               key="empty"
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               className="w-full flex flex-col items-center justify-center py-24 px-10 rounded-[2.5rem] border-2 border-dashed border-slate-200 bg-white/50 text-center"
             >
                <div className="w-16 h-16 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-center text-3xl mb-6">✓</div>
                <h3 className="text-xl font-black text-slate-800 tracking-tight">{t('queue.emptyTodayTitle')}</h3>
                <p className="text-xs font-bold text-slate-400 mt-3 uppercase tracking-widest leading-relaxed">
                  {t('queue.emptyTodaySubtitle')}
                </p>
             </motion.div>
          ) : (
            <div className="w-full space-y-6">
              <SwipeableCard 
                key={activeIntent.id}
                intent={activeIntent}
                onAction={(type) => setPendingAction({ intent: activeIntent, type })}
              />

              {/* Deck Navigation Controls */}
              <div className="flex items-center justify-between px-6">
                 <button 
                  disabled={activeIndex === 0}
                  onClick={() => setActiveIndex(prev => prev - 1)}
                  className="w-12 h-12 rounded-full border border-slate-200 bg-white flex items-center justify-center disabled:opacity-20 hover:bg-slate-50 transition-colors shadow-sm"
                 >
                    <ChevronLeft size={20} className="text-slate-600" />
                 </button>

                 <div className="flex items-center gap-1.5 p-2 bg-slate-100/50 rounded-full">
                    {filteredCalls.slice(0, 5).map((_, i) => (
                      <div 
                        key={i} 
                        className={cn('w-1.5 h-1.5 rounded-full transition-all duration-300', i === activeIndex ? 'bg-slate-900 w-4' : 'bg-slate-300')} 
                      />
                    ))}
                    {queueCount > 5 && <span className="text-[10px] font-black text-slate-400 px-1">+{queueCount - 5}</span>}
                 </div>

                 <button 
                  disabled={activeIndex === queueCount - 1}
                  onClick={() => setActiveIndex(prev => prev + 1)}
                  className="w-12 h-12 rounded-full border border-slate-200 bg-white flex items-center justify-center disabled:opacity-20 hover:bg-slate-50 transition-colors shadow-sm"
                 >
                    <ChevronRight size={20} className="text-slate-600" />
                 </button>
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>

      <LeadActionOverlay
        intent={pendingAction?.intent as HunterIntent}
        actionType={pendingAction?.type as LeadActionType}
        isOpen={!!pendingAction}
        onClose={() => setPendingAction(null)}
        onComplete={handleActionComplete}
      />
    </div>
  );
}

// ─── SWIPEABLE CARD WRAPPER ────────────────────────────────────────
function SwipeableCard({ 
  intent, 
  onAction 
}: { 
  intent: HunterIntent; 
  onAction: (type: LeadActionType) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.3 }}
    >
      <HunterCard 
        intent={intent} 
        onAction={onAction}
      />
    </motion.div>
  );
}
