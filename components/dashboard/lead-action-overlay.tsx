'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X, Phone, Star, CheckCircle2, ChevronRight, Hash, Trash2, UserCheck, FileText, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn, safeDecode, formatDisplayLocation } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { HunterIntent } from '@/lib/types/hunter';

export type LeadActionType = 'junk' | 'gorusuldu' | 'teklif' | 'satis';

interface LeadActionOverlayProps {
  intent: HunterIntent;
  actionType: LeadActionType | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (phone?: string, score?: number) => Promise<void>;
}

export function LeadActionOverlay({
  intent,
  actionType,
  isOpen,
  onClose,
  onComplete
}: LeadActionOverlayProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'phone' | 'rating' | 'success'>('phone');
  const [phone, setPhone] = useState('');
  const [score, setScore] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Set initial score based on actionType
  useEffect(() => {
    if (isOpen && actionType) {
      setStep('phone');
      setPhone('');
      setIsSubmitting(false);
      
      switch (actionType) {
        case 'junk': setScore(0); setStep('rating'); break; // Skip phone for junk if we want, or confirm
        case 'gorusuldu': setScore(60); break;
        case 'teklif': setScore(80); break;
        case 'satis': setScore(100); break;
      }
    }
  }, [isOpen, actionType]);

  const config = useMemo(() => {
    switch (actionType) {
      case 'junk': return { label: t('hunter.junk'), icon: Trash2, color: 'text-red-600', bg: 'bg-red-50' };
      case 'gorusuldu': return { label: t('hunter.gorusuldu'), icon: UserCheck, color: 'text-sky-600', bg: 'bg-sky-50' };
      case 'teklif': return { label: t('hunter.teklif'), icon: FileText, color: 'text-amber-600', bg: 'bg-amber-50' };
      case 'satis': return { label: t('hunter.seal'), icon: ShieldCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' };
      default: return { label: '', icon: Hash, color: 'text-slate-600', bg: 'bg-slate-50' };
    }
  }, [actionType, t]);

  const handleNext = () => {
    if (actionType === 'junk') {
      handleComplete(0);
    } else {
      setStep('rating');
    }
  };

  const handleComplete = async (finalScore: number) => {
    setIsSubmitting(true);
    await onComplete(phone, finalScore);
    setIsSubmitting(false);
    setStep('success');
    setTimeout(() => onClose(), 1500);
  };

  if (!isOpen || !actionType) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose} />

      <Card className="relative w-full max-w-lg bg-white overflow-hidden border-0 sm:border border-slate-200 shadow-2xl rounded-none sm:rounded-3xl animate-in slide-in-from-bottom-5 duration-400">
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shadow-sm', config.bg, config.color)}>
              <config.icon size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 leading-none uppercase tracking-tight">{config.label}</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                {safeDecode((intent.utm_term || '').trim()) || t('hunter.anonimContact')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-8 flex flex-col items-center justify-center min-h-[400px]">
          {step === 'phone' && (
            <div className="w-full space-y-8 animate-in fade-in zoom-in-95 duration-300">
              <div className="text-center space-y-3">
                <div className="inline-flex p-5 bg-blue-50 rounded-2xl text-blue-600 mb-2">
                   <Phone size={32} />
                </div>
                <h3 className="text-2xl font-black text-slate-900">{t('session.phone')}</h3>
                <p className="text-slate-500 font-bold text-xs uppercase tracking-wider">{t('seal.phoneStepHint')}</p>
              </div>

              <input 
                type="tel"
                placeholder="05..."
                autoFocus
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full h-20 text-center text-3xl font-black tracking-widest bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white outline-none transition-all placeholder:text-slate-200"
              />

              <div className="space-y-3">
                <Button onClick={handleNext} className="w-full h-16 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg">
                  {t('seal.next')} <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
                <button onClick={() => setStep('rating')} className="w-full py-2 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-slate-600 transition-colors">
                  {t('hunter.skip')}
                </button>
              </div>
            </div>
          )}

          {step === 'rating' && (
            <div className="w-full space-y-8 animate-in fade-in zoom-in-95 duration-300 text-center">
              <div className="space-y-3">
                <div className={cn('inline-flex p-5 rounded-2xl mb-2', config.bg, config.color)}>
                   <Star size={32} />
                </div>
                <h3 className="text-2xl font-black text-slate-900">{config.label}</h3>
                <p className="text-slate-500 font-bold text-xs uppercase tracking-wider">SKOR TEYİDİ: {score} PTS</p>
              </div>

              <div className="relative max-w-xs mx-auto">
                <input 
                  type="number"
                  value={score}
                  onChange={(e) => setScore(parseInt(e.target.value) || 0)}
                  className="w-full h-24 text-center text-5xl font-black bg-slate-50 border-2 border-slate-100 rounded-3xl focus:border-emerald-500 focus:bg-white outline-none transition-all"
                />
                <div className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-300 font-black">PTS</div>
              </div>

              <Button 
                onClick={() => handleComplete(score)}
                disabled={isSubmitting}
                className={cn('w-full h-16 rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg text-white', 
                  actionType === 'junk' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                )}
              >
                {isSubmitting ? t('seal.sealing') : t('button.confirm').toUpperCase()}
              </Button>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center justify-center space-y-4 animate-in zoom-in-95 duration-400">
              <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-xl">
                 <CheckCircle2 size={40} />
              </div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">{t('toast.saved')}</h3>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
