'use client';

import React, { useState } from 'react';
import type { PipelineStage } from '@/lib/types/database';
import type { HunterIntent } from '@/lib/types/hunter';
import { SimpleIntentCard } from './intent-card-simple';

export function PanelFeed({
  initialCalls,
  pipelineStages
}: {
  initialCalls: HunterIntent[];
  pipelineStages: PipelineStage[];
}) {
  const [calls] = useState(initialCalls);

  const handleGearShift = async (callId: string, gearId: string, phoneHashString?: string) => {
    try {
      const res = await fetch(`/api/intents/${callId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gear_id: gearId, phone: phoneHashString })
      });
      if (!res.ok) throw new Error('API Hatası');
      
      // We don't remove it from list, its own state will show green check
      return true;
    } catch (err) {
      console.error(err);
      alert('İşlem başarısız oldu. Lütfen tekrar deneyin.');
      return false;
    }
  };

  if (!calls || calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-slate-300 rounded-3xl mt-12 bg-white/50">
         <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-3xl mb-4">💤</div>
         <h3 className="text-xl font-bold text-slate-800">Bekleyen Aksiyon Yok</h3>
         <p className="text-slate-500 font-semibold mt-2 text-sm">Şu an için yeni bir müşteri tıklaması bulunmuyor.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
       {calls.map((call) => (
          <SimpleIntentCard 
            key={call.id} 
            intent={call} 
            pipelineStages={pipelineStages} 
            onGearShift={handleGearShift} 
          />
       ))}
    </div>
  );
}
