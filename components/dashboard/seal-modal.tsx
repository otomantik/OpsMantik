'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Trash2, Phone, CircleDollarSign, ChevronRight, ChevronLeft, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useSfx } from '@/lib/hooks/use-sfx';

export interface SealModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  chipValues?: number[];
  /** Clicked number for pre-filling or reference */
  clickedNumber?: string | null;
  onConfirm: (
    saleAmount: number | null,
    currency: string,
    leadScore: number,
    callerPhone?: string
  ) => Promise<void>;
  onJunk?: () => Promise<void>;
  onSuccess?: () => void;
  onJunkSuccess?: () => void;
  onError?: (message: string) => void;
}

export function SealModal({
  open,
  onOpenChange,
  currency,
  clickedNumber,
  onConfirm,
  onJunk,
  onSuccess,
  onJunkSuccess,
  onError,
}: SealModalProps) {
  void clickedNumber;
  const { t } = useTranslation();
  
  // Step 1: Phone (Identity), Step 2: Revenue (Value)
  const [step, setStep] = useState<1 | 2>(1);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [callerPhone, setCallerPhone] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [junking, setJunking] = useState(false);
  const [sealSuccessPulse, setSealSuccessPulse] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setCallerPhone('');
      setCustomAmount('');
    }
  }, [open]);

  const sfxSrc = useMemo(() => '/sounds/cha-ching.mp3', []);
  const { play: playChaChing } = useSfx(sfxSrc);

  const customNum = customAmount.trim() ? Number(customAmount.trim()) : null;
  const effectiveAmount =
    customNum != null && !Number.isNaN(customNum) && customNum >= 0 ? customNum : null;

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    try {
      const toSend = callerPhone.trim().slice(0, 64) || undefined;
      // Sales always send 100 points as per simplified math v2
      await onConfirm(effectiveAmount ?? null, currency, 100, toSend);

      try { playChaChing(); } catch { }
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          (navigator as Navigator).vibrate?.(50);
        }
      } catch { }

      setSealSuccessPulse(true);
      window.setTimeout(() => setSealSuccessPulse(false), 420);

      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('seal.errorSeal');
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  }, [effectiveAmount, currency, callerPhone, onConfirm, onSuccess, onError, onOpenChange, playChaChing, t]);

  const handleJunk = useCallback(async () => {
    if (!onJunk) return;
    setJunking(true);
    try {
      await onJunk();
      onJunkSuccess?.();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('seal.errorMarkJunk');
      onError?.(msg);
    } finally {
      setJunking(false);
    }
  }, [onJunk, onJunkSuccess, onError, onOpenChange, t]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[min(85vh,520px)] flex flex-col bg-white text-slate-950 border-t border-slate-200 rounded-t-3xl shadow-2xl"
      >
        <SheetHeader className="pb-4">
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2">
              {[1, 2].map((s) => (
                <div 
                  key={s} 
                  className={cn(
                    "w-12 h-1.5 rounded-full transition-all duration-300",
                    step >= s ? "bg-emerald-500" : "bg-slate-200"
                  )} 
                />
              ))}
            </div>
          </div>
          <SheetTitle className="flex items-center justify-center gap-2 text-2xl font-black italic tracking-tighter text-slate-900 uppercase">
             <ShieldCheck className="h-6 w-6 text-emerald-600" />
             {t('seal.title').toUpperCase()}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full space-y-8">
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 text-center">
              <div className="space-y-2">
                <h3 className="text-xl font-black text-slate-800">{t('session.phone')}</h3>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-none mb-4">
                  {t('seal.phoneStepHint')}
                </p>
              </div>
              <div className="relative group">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                  <Phone className="h-6 w-6" />
                </div>
                <input
                  id="seal-caller-phone"
                  type="tel"
                  placeholder="+90 532 ..."
                  className="w-full rounded-3xl border-2 border-slate-100 bg-slate-50 px-16 py-6 text-2xl font-black text-slate-900 focus:border-emerald-500 focus:bg-white outline-none transition-all shadow-sm"
                  value={callerPhone}
                  onChange={(e) => setCallerPhone(e.target.value)}
                  autoFocus
                />
              </div>
              <button 
                onClick={() => setStep(2)}
                className="text-slate-400 font-black text-[10px] uppercase tracking-[0.2em] hover:text-slate-600 transition-colors"
              >
                {t('hunter.skip').toUpperCase()}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="text-center space-y-2">
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">{t('seal.step.revenue').toUpperCase()}</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {t('seal.revenueStepHint')}
                </p>
              </div>

              <div className="relative group">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                  <span className="text-2xl font-black">{currency}</span>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-full rounded-3xl border-2 border-slate-100 bg-slate-50 px-20 py-8 text-4xl font-black text-slate-900 focus:border-emerald-500 focus:bg-white outline-none transition-all shadow-sm"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  autoFocus
                />
              </div>

              {callerPhone && (
                 <div className="flex items-center justify-center gap-2 text-emerald-600 font-bold text-sm bg-emerald-50 py-3 rounded-2xl border border-emerald-100">
                    <Phone size={14} />
                    {callerPhone}
                 </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="pt-6 border-t border-slate-100 pb-safe px-2">
          <div className="flex items-center justify-between w-full gap-4">
            {step === 1 ? (
              <Button
                variant="ghost"
                className="text-red-500 hover:bg-red-50 hover:text-red-600 font-black text-[10px] uppercase tracking-widest"
                onClick={handleJunk}
                disabled={junking}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('seal.junk')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="text-slate-400 hover:text-slate-600 font-black text-[10px] uppercase tracking-widest"
                onClick={() => setStep(1)}
                disabled={saving}
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                {t('seal.back')}
              </Button>
            )}

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                className="font-black text-[10px] uppercase tracking-widest border-slate-200 text-slate-400 rounded-xl"
                onClick={() => onOpenChange(false)}
              >
                {t('seal.cancel')}
              </Button>
              
              {step === 1 ? (
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-10 py-7 rounded-2xl shadow-lg transition-all hover:scale-105 active:scale-95 text-xs uppercase tracking-widest"
                  onClick={() => setStep(2)}
                >
                  {t('seal.next')}
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button
                  className={cn(
                    "bg-slate-900 hover:bg-black text-white font-black px-12 py-7 rounded-2xl shadow-xl transition-all hover:scale-105 active:scale-95 text-xs uppercase tracking-widest",
                    sealSuccessPulse && "scale-110 bg-emerald-600"
                  )}
                  onClick={handleConfirm}
                  disabled={saving}
                >
                  {saving ? t('seal.sealing').toUpperCase() : t('seal.send').toUpperCase()}
                  <Send className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
