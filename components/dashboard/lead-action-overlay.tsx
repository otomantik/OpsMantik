'use client';

import React, { useState, useEffect } from 'react';
import { X, Phone, Star, CheckCircle2, ChevronRight, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { HunterIntent } from '@/lib/types/hunter';

interface LeadActionOverlayProps {
  intent: HunterIntent;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (phone?: string, score?: number) => Promise<void>;
}

import { safeDecode, formatDisplayLocation } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function LeadActionOverlay({
  intent,
  isOpen,
  onClose,
  onComplete
}: LeadActionOverlayProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'phone' | 'rating' | 'success'>('phone');
  const [phone, setPhone] = useState('');
  const [score, setScore] = useState<number | null>(100);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setStep('phone');
      setPhone('');
      setScore(100);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleNext = () => {
    setStep('rating');
  };

  const handleScoreSelect = async (val: number) => {
    setScore(val);
    setIsSubmitting(true);
    await onComplete(phone, val);
    setIsSubmitting(false);
    setStep('success');
    
    // Auto close after success
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-500" 
        onClick={onClose}
      />

      <Card className="relative w-full h-full sm:h-auto sm:max-w-xl overflow-hidden border-0 sm:border border-slate-200 bg-white shadow-[0_30px_60px_rgba(0,0,0,0.15)] flex flex-col rounded-none sm:rounded-[3rem] animate-in slide-in-from-bottom-10 duration-500">
        {/* Header */}
        <div className="p-6 sm:p-8 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Hash size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight leading-none uppercase">
                {safeDecode((intent.utm_term || '').trim()) || t('hunter.anonimContact')}
              </h2>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">
                {formatDisplayLocation(intent.city || null, intent.district || null, intent.location_source) || t('hunter.locationUnknown')}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-12 h-12 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors"
          >
            <X size={28} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 sm:p-10 flex flex-col items-center justify-center text-center">
          {step === 'phone' && (
            <div className="w-full max-w-sm space-y-10 animate-in fade-in zoom-in-95 duration-500">
              <div className="space-y-4">
                <div className="inline-flex p-6 bg-blue-50 rounded-[2.5rem] text-blue-600 mb-2">
                   <Phone size={40} />
                </div>
                <h3 className="text-3xl font-black text-slate-900 tracking-tight">{t('session.phone')}</h3>
                <p className="text-slate-500 font-bold text-sm leading-relaxed">{t('seal.phoneStepHint')}</p>
              </div>

              <div className="relative">
                <input 
                  type="tel"
                  placeholder="05..."
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full h-24 text-center text-4xl font-black tracking-widest bg-slate-50 border-4 border-slate-100 rounded-4xl focus:border-blue-600 focus:bg-white outline-none transition-all placeholder:text-slate-200 shadow-inner"
                />
              </div>

              <div className="flex flex-col gap-4">
                <Button 
                  onClick={handleNext}
                  className="w-full h-20 bg-blue-600 hover:bg-blue-700 text-white rounded-3xl font-black text-xl shadow-xl shadow-blue-500/30"
                >
                  {t('seal.next')} <ChevronRight className="ml-2" />
                </Button>
                
                <button 
                  onClick={() => setStep('rating')}
                  className="text-slate-400 font-black text-[11px] uppercase tracking-widest hover:text-blue-600 transition-colors py-2"
                >
                  {t('hunter.skip')} · {t('hunter.gorusuldu')}
                </button>
              </div>
            </div>
          )}

          {step === 'rating' && (
            <div className="w-full max-w-sm space-y-10 animate-in fade-in zoom-in-95 duration-500">
               <div className="space-y-4">
                <div className="inline-flex p-6 bg-emerald-50 rounded-[2.5rem] text-emerald-600 mb-2">
                   <Star size={40} />
                </div>
                <h3 className="text-3xl font-black text-slate-900 tracking-tight">{t('hunter.seal')} (1-100 PTS)</h3>
                <p className="text-slate-500 font-bold text-sm leading-relaxed">{t('seal.revenueStepHint')}</p>
              </div>

              <div className="relative">
                <input 
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="100"
                  placeholder="100"
                  autoFocus
                  value={score || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) setScore(Math.min(100, Math.max(1, val)));
                    else if (e.target.value === '') setScore(null);
                  }}
                  className="w-full h-28 text-center text-6xl font-black text-emerald-600 bg-slate-50 border-4 border-slate-100 rounded-[2.5rem] focus:border-emerald-500 focus:bg-white outline-none transition-all placeholder:text-slate-200 shadow-inner"
                />
                <div className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-200 font-black text-2xl">PTS</div>
              </div>

              <div className="flex flex-col gap-4">
                <Button 
                  onClick={() => score && handleScoreSelect(score)}
                  disabled={isSubmitting || !score || score < 1 || score > 100}
                  className="w-full h-20 bg-emerald-600 hover:bg-emerald-700 text-white rounded-3xl font-black text-xl shadow-xl shadow-emerald-500/30"
                >
                  {isSubmitting ? t('seal.sealing') : t('hunter.seal').toUpperCase()}
                </Button>

                <button 
                  onClick={() => setStep('phone')}
                  className="text-slate-400 font-black text-[11px] uppercase tracking-widest hover:text-slate-600 transition-colors py-2 flex items-center gap-2 mx-auto"
                >
                  {t('seal.back')}
                </button>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center justify-center space-y-6 animate-in zoom-in-95 duration-500">
              <div className="w-32 h-32 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-2xl shadow-emerald-500/40">
                 <CheckCircle2 size={64} />
              </div>
              <div className="space-y-2">
                <h3 className="text-4xl font-black text-slate-900 tracking-tight uppercase">{t('activity.statusConfirmed')}</h3>
                <p className="text-emerald-600 font-black uppercase tracking-[0.2em] text-[11px]">{t('toast.saved')}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer padding for mobile safari */}
        <div className="h-10 sm:hidden bg-slate-50/50" />
      </Card>
    </div>
  );
}
