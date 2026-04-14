'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Phone, Trash2, CheckCircle2 } from 'lucide-react';
import { cn, safeDecode, formatDisplayLocation } from '@/lib/utils';
import type { HunterIntent } from '@/lib/types/hunter';
import type { PipelineStage } from '@/lib/types/database';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function SimpleIntentCard({
  intent,
  pipelineStages,
  onGearShift
}: {
  intent: HunterIntent;
  pipelineStages: PipelineStage[];
  onGearShift: (callId: string, gearId: string, phoneHashString?: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [activeGear, setActiveGear] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  // Deriving UI values
  const keyword = safeDecode((intent.utm_term || '').trim()) || t('panel.searchTermUnknown');
  const locationDisplay = formatDisplayLocation(intent.city || null, intent.district || null, intent.location_source) || t('hunter.locationUnknown');
  
  const handleActionClick = (stage: PipelineStage) => {
    setActiveGear(stage.id);
  };

  const handleConfirm = async () => {
    if (!activeGear) return;
    setIsSubmitting(true);
    const success = await onGearShift(intent.id, activeGear, phoneNumber);
    setIsSubmitting(false);
    if (success) {
      setIsCompleted(true);
    }
  };

  const handleDiscard = async () => {
    setIsSubmitting(true);
    // Explicitly sending junk
    const success = await onGearShift(intent.id, 'g_trash'); 
    setIsSubmitting(false);
    if (success) {
      setIsCompleted(true);
    }
  };

  // If completed, just show a green tick and hide the mess
  if (isCompleted) {
    return (
      <Card className="p-4 border border-slate-100 bg-slate-50/50 rounded-2xl mb-4 flex items-center justify-between opacity-50">
        <div>
          <h3 className="text-lg font-bold text-slate-800 line-through decoration-slate-300">{keyword}</h3>
          <p className="text-xs font-semibold text-slate-400 mt-0.5">{locationDisplay}</p>
        </div>
        <CheckCircle2 className="text-emerald-500 h-6 w-6" />
      </Card>
    );
  }

  // Filter out trash/discard stage from main buttons
  const playStages = pipelineStages.filter(s => s.action !== 'discard' && s.id !== 'g_trash').sort((a,b) => a.order - b.order);

  return (
    <Card className="p-4 border border-slate-200 shadow-sm rounded-2xl mb-4 bg-white relative overflow-hidden transition-all">
      {/* Absolute Junk Button */}
      {!activeGear && (
        <button 
          onClick={handleDiscard}
          disabled={isSubmitting}
          className="absolute top-4 right-4 text-slate-300 hover:text-rose-500 transition-colors flex items-center gap-1 text-[10px] uppercase font-bold tracking-widest"
        >
          <Trash2 size={12} /> {t('hunter.junk')}
        </button>
      )}

      {/* Header Info */}
      <div className="pr-16">
        <h3 className="text-xl sm:text-2xl font-black text-slate-800 leading-tight">
          {keyword}
        </h3>
        <p className="text-sm font-semibold text-blue-600 mt-1 flex items-center gap-1.5 uppercase tracking-wide">
          <MapPin size={14} className="shrink-0" /> {locationDisplay}
        </p>
      </div>

      {activeGear ? (
        <div className="mt-5 p-4 rounded-xl border border-slate-100 bg-slate-50 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
            {t('panel.trainGoogleOptional')}
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 h-4 w-4" />
            <input
              type="tel"
              disabled={isSubmitting}
              placeholder={t('panel.phonePlaceholder')}
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full h-12 pl-9 pr-4 rounded-lg border border-slate-200 bg-white text-base font-bold text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-shadow"
            />
          </div>
          
          <div className="flex gap-2 mt-3">
             <Button 
                variant="ghost" 
                className="flex-1 font-semibold text-slate-500 hover:text-slate-700"
                onClick={() => setActiveGear(null)}
                disabled={isSubmitting}
              >
                {t('button.cancel')}
             </Button>
             <Button 
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold"
                onClick={handleConfirm}
                disabled={isSubmitting}
              >
                {isSubmitting ? '...' : (phoneNumber ? t('panel.matchAndLaunch') : t('panel.confirmWithoutPhone'))}
             </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-5">
          {playStages.map((stage) => {
             // Basic styling mapping (using safe presets since dynamic tailwind classes need whitelisting)
             const colorMap: Record<string, string> = {
                slate: 'border-slate-200 text-slate-700 hover:bg-slate-50',
                orange: 'border-orange-200 text-orange-700 hover:bg-orange-50',
                blue: 'border-blue-200 text-blue-700 hover:bg-blue-50',
                rose: 'border-rose-200 text-rose-700 hover:bg-rose-50',
                emerald: 'bg-emerald-500 hover:bg-emerald-600 text-white border-transparent border-0'
             };
             
             // Default to slate if color config is weird, except for macro (usually emerald)
             const isMacro = stage.is_macro || stage.multiplier === 1;
             const baseCls = isMacro
                ? colorMap['emerald']
                : (colorMap[stage.color] || colorMap['slate']);

             return (
              <Button
                key={stage.id}
                variant={isMacro ? 'default' : 'outline'}
                onClick={() => handleActionClick(stage)}
                className={cn(
                  "h-14 font-bold transition-all text-sm sm:text-base border-2 shadow-sm rounded-xl overflow-hidden",
                  baseCls
                )}
              >
                <span className="truncate w-full">{stage.label}</span>
              </Button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
