'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X, Phone, Star, CheckCircle2, ChevronRight, Hash, Trash2, UserCheck, FileText, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn, safeDecode } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { HunterIntent } from '@/lib/types/hunter';
import type { HelperFormPayload } from '@/lib/oci/optimization-contract';

export type LeadActionType = 'junk' | 'contacted' | 'offered' | 'won';

interface LeadActionOverlayProps {
  intent: HunterIntent;
  actionType: LeadActionType | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (
    actionType: LeadActionType,
    phone?: string,
    score?: number,
    helperFormPayload?: HelperFormPayload | null
  ) => Promise<{ success: boolean; error?: string }>;
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
  const [helperFormPayload, setHelperFormPayload] = useState<HelperFormPayload>({
    jobSize: 'orta',
    urgency: 'orta',
    priceDiscussed: 'hayir',
    followupExpectation: 'belirsiz',
    competitorComparison: 'hayir',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Set initial score based on actionType
  useEffect(() => {
    if (isOpen && actionType) {
      setStep('phone');
      setPhone('');
      setHelperFormPayload({
        jobSize: 'orta',
        urgency: 'orta',
        priceDiscussed: 'hayir',
        followupExpectation: 'belirsiz',
        competitorComparison: 'hayir',
      });
      setIsSubmitting(false);
      setSubmitError(null);
      
      switch (actionType) {
        case 'junk': setScore(0); setStep('rating'); break;
        case 'contacted': setScore(60); break;
        case 'offered': setScore(80); break;
        case 'won': setScore(100); break;
      }
    }
  }, [isOpen, actionType]);

  const config = useMemo(() => {
    switch (actionType) {
      case 'junk': return { label: t('hunter.junk'), icon: Trash2, color: 'text-red-600', bg: 'bg-red-50' };
      case 'contacted': return { label: t('hunter.contacted'), icon: UserCheck, color: 'text-sky-600', bg: 'bg-sky-50' };
      case 'offered': return { label: t('hunter.offered'), icon: FileText, color: 'text-amber-600', bg: 'bg-amber-50' };
      case 'won': return { label: t('hunter.seal'), icon: ShieldCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' };
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
    if (!actionType) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const result = await onComplete(actionType, phone, finalScore, helperFormPayload);
    setIsSubmitting(false);
    if (!result.success) {
      setSubmitError(result.error ?? t('toast.failedUpdate'));
      return;
    }
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
                placeholder={t('panel.phonePlaceholder')}
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
                {submitError && (
                  <p className="text-center text-xs font-bold text-red-600">{submitError}</p>
                )}
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
                <p className="text-slate-500 font-bold text-xs uppercase tracking-wider">{t('hunter.scoreConfirmation')}: {score} {t('hunter.pts')}</p>
              </div>

              <div className="relative max-w-xs mx-auto">
                <input 
                  type="number"
                  value={score}
                  onChange={(e) => setScore(parseInt(e.target.value) || 0)}
                  className="w-full h-24 text-center text-5xl font-black bg-slate-50 border-2 border-slate-100 rounded-3xl focus:border-emerald-500 focus:bg-white outline-none transition-all"
                />
                <div className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-300 font-black">{t('hunter.pts')}</div>
              </div>

              {actionType !== 'junk' && (
                <div className="grid grid-cols-1 gap-3 text-left">
                  <select
                    value={helperFormPayload.jobSize ?? 'orta'}
                    onChange={(e) => setHelperFormPayload((prev) => ({ ...prev, jobSize: e.target.value as HelperFormPayload['jobSize'] }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                  >
                    <option value="kucuk">Is buyuklugu: kucuk</option>
                    <option value="orta">Is buyuklugu: orta</option>
                    <option value="buyuk">Is buyuklugu: buyuk</option>
                  </select>
                  <select
                    value={helperFormPayload.urgency ?? 'orta'}
                    onChange={(e) => setHelperFormPayload((prev) => ({ ...prev, urgency: e.target.value as HelperFormPayload['urgency'] }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                  >
                    <option value="dusuk">Aciliyet: dusuk</option>
                    <option value="orta">Aciliyet: orta</option>
                    <option value="yuksek">Aciliyet: yuksek</option>
                  </select>
                  <select
                    value={helperFormPayload.priceDiscussed ?? 'hayir'}
                    onChange={(e) => setHelperFormPayload((prev) => ({ ...prev, priceDiscussed: e.target.value as HelperFormPayload['priceDiscussed'] }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                  >
                    <option value="evet">Fiyat konusuldu: evet</option>
                    <option value="hayir">Fiyat konusuldu: hayir</option>
                  </select>
                  <select
                    value={helperFormPayload.followupExpectation ?? 'belirsiz'}
                    onChange={(e) => setHelperFormPayload((prev) => ({ ...prev, followupExpectation: e.target.value as HelperFormPayload['followupExpectation'] }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                  >
                    <option value="hayir">Geri donus beklentisi: hayir</option>
                    <option value="belirsiz">Geri donus beklentisi: belirsiz</option>
                    <option value="evet">Geri donus beklentisi: evet</option>
                  </select>
                  <select
                    value={helperFormPayload.competitorComparison ?? 'hayir'}
                    onChange={(e) => setHelperFormPayload((prev) => ({ ...prev, competitorComparison: e.target.value as HelperFormPayload['competitorComparison'] }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                  >
                    <option value="evet">Rakip kiyasi: evet</option>
                    <option value="hayir">Rakip kiyasi: hayir</option>
                  </select>
                </div>
              )}

              <Button 
                onClick={() => handleComplete(score)}
                disabled={isSubmitting}
                className={cn('w-full h-16 rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg text-white', 
                  actionType === 'junk' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                )}
              >
                {isSubmitting ? t('seal.sealing') : t('button.confirm').toUpperCase()}
              </Button>
              {submitError && (
                <p className="text-center text-xs font-bold text-red-600">{submitError}</p>
              )}
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
