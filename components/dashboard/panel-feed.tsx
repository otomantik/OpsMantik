'use client';

import React, { useState, useMemo } from 'react';
import type { HunterIntent } from '@/lib/types/hunter';
import { PanelIntentCard } from './panel-intent-card';
import { LeadActionOverlay } from './lead-action-overlay';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PanelFeed({
  initialCalls
}: {
  initialCalls: HunterIntent[];
}) {
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

  const handleActionComplete = async (phone?: string, score?: number) => {
    if (!selectedIntent) return;
    
    try {
      const res = await fetch(`/api/intents/${selectedIntent.id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, score })
      });
      if (!res.ok) throw new Error('API Hatası');
      
      // Post-complete: Remove from current view optimistically
      setCalls(prev => prev.filter(c => c.id !== selectedIntent.id));
    } catch (err) {
      console.error(err);
      alert('İşlem kaydedilirken hata oluştu.');
    }
  };

  return (
    <div className="space-y-6">
       {/* Date Filter Bar */}
       <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200 shadow-sm">
             <button 
                onClick={() => setDateFilter('today')}
                className={cn(
                  "px-4 py-1.5 text-xs font-black rounded-lg transition-all uppercase tracking-widest",
                   dateFilter === 'today' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                )}
             >
                Bugün
             </button>
             <button 
                onClick={() => setDateFilter('yesterday')}
                className={cn(
                  "px-4 py-1.5 text-xs font-black rounded-lg transition-all uppercase tracking-widest",
                   dateFilter === 'yesterday' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                )}
             >
                Dün
             </button>
             <button 
                onClick={() => setDateFilter('all')}
                className={cn(
                  "px-4 py-1.5 text-xs font-black rounded-lg transition-all uppercase tracking-widest",
                   dateFilter === 'all' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                )}
             >
                Hepsi
             </button>
          </div>
          <div className="text-slate-300">
             <Calendar size={20} />
          </div>
       </div>

       {filteredCalls.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-slate-200 rounded-4xl bg-white/30 backdrop-blur-sm">
             <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-3xl mb-4 shadow-sm">💤</div>
             <h3 className="text-xl font-bold text-slate-800">Harika! Bekleyen Yok</h3>
             <p className="text-slate-400 font-semibold mt-2 text-sm uppercase tracking-wide">Tüm leadleri işlediniz veya hiç yeni niyet yok.</p>
          </div>
       ) : (
          <div className="grid gap-3">
             {filteredCalls.map((call) => (
                <PanelIntentCard 
                  key={call.id} 
                  intent={call} 
                  onClick={() => setSelectedIntent(call)} 
                />
             ))}
          </div>
       )}

       <LeadActionOverlay 
          intent={selectedIntent as HunterIntent}
          isOpen={!!selectedIntent}
          onClose={() => setSelectedIntent(null)}
          onComplete={handleActionComplete}
       />
    </div>
  );
}
