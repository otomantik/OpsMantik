'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { MapPin, Clock, ChevronRight } from 'lucide-react';
import { formatDisplayLocation, safeDecode } from '@/lib/utils';
import type { HunterIntent } from '@/lib/types/hunter';

export function PanelIntentCard({
  intent,
  onClick
}: {
  intent: HunterIntent;
  onClick: () => void;
}) {
  const keyword = safeDecode((intent.utm_term || '').trim()) || 'Bilinmeyen Arama';
  const locationDisplay = formatDisplayLocation(intent.city || null, intent.district || null, intent.location_source) || 'Konum Bilinmiyor';
  const timeDisplay = new Date(intent.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Card 
      onClick={onClick}
      className="p-5 border border-slate-200/60 shadow-sm rounded-3xl bg-white hover:bg-slate-50 transition-all cursor-pointer group active:scale-[0.98]"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 mb-1">
             <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                Yeni Niyet
             </span>
             <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-widest">
                <Clock size={10} /> {timeDisplay}
             </span>
          </div>
          <h3 className="text-xl font-black text-slate-800 leading-tight truncate">
            {keyword}
          </h3>
          <p className="text-xs font-semibold text-slate-500 flex items-center gap-1 truncate uppercase tracking-wide">
            <MapPin size={12} className="shrink-0 text-slate-400" /> {locationDisplay}
          </p>
        </div>
        
        <div className="w-10 h-10 rounded-full bg-slate-50 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center text-slate-300 transition-all">
           <ChevronRight size={20} />
        </div>
      </div>
    </Card>
  );
}
