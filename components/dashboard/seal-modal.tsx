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
import { HELPER_FORM_DEFAULTS, type HelperFormPayload } from '@/lib/oci/optimization-contract';

export interface SealModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  chipValues?: number[];
  /** Clicked number for pre-filling or reference (not displayed as a separate box anymore) */
  clickedNumber?: string | null;
  onConfirm: (
    saleAmount: number | null,
    currency: string,
    leadScore: number,
    callerPhone?: string,
    helperFormPayload?: HelperFormPayload | null
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [callerPhone, setCallerPhone] = useState<string>('');
  const [helperFormPayload, setHelperFormPayload] = useState<HelperFormPayload>({ ...HELPER_FORM_DEFAULTS });
  const [saving, setSaving] = useState(false);
  const [junking, setJunking] = useState(false);
  const [sealSuccessPulse, setSealSuccessPulse] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      // Do NOT pre-fill with clickedNumber: that's the business number the visitor clicked.
      // Operator must enter the CUSTOMER's number (they spoke with on the phone).
      setCallerPhone('');
      setHelperFormPayload({ ...HELPER_FORM_DEFAULTS });
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
      await onConfirm(effectiveAmount ?? null, currency, 100, toSend, helperFormPayload);

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
      setCustomAmount('');
      setCallerPhone('');
      setStep(1);
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
      setCustomAmount('');
      setCallerPhone('');
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
        className="h-[min(85vh,480px)] flex flex-col bg-white text-slate-950 border-t border-slate-200 rounded-t-3xl shadow-2xl"
      >
        <SheetHeader className="pb-4">
          <div className="flex justify-center mb-2">
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((s) => (
                <div 
                  key={s} 
                  className={cn(
                    "w-8 h-1.5 rounded-full transition-all duration-300",
                    step >= s ? "bg-emerald-500" : "bg-slate-200"
                  )} 
                />
              ))}
            </div>
          </div>
          <SheetTitle className="flex items-center justify-center gap-2 text-xl font-black italic tracking-tighter text-slate-800 uppercase">
            {step === 1 && <Phone className="h-5 w-5 text-emerald-600" />}
            {step === 2 && <CircleDollarSign className="h-5 w-5 text-emerald-600" />}
            {step === 3 && <ShieldCheck className="h-6 w-6 text-emerald-600" />}
            {step === 1 && t('seal.step.phone')}
            {step === 2 && t('seal.step.revenue')}
            {step === 3 && t('seal.step.confirm')}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full space-y-6">
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                  <Phone className="h-5 w-5" />
                </div>
                <input
                  id="seal-caller-phone"
                  type="tel"
                  placeholder="+90 532 ..."
                  className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-12 py-5 text-xl font-bold text-slate-900 focus:border-emerald-500 focus:bg-white outline-none transition-all shadow-sm"
                  value={callerPhone}
                  onChange={(e) => setCallerPhone(e.target.value)}
                  autoFocus
                />
              </div>
              <p className="text-sm text-center text-slate-500 px-4">
                {t('seal.phoneStepHint')}
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                  <span className="text-xl font-bold">{currency}</span>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-16 py-5 text-2xl font-black text-slate-900 focus:border-emerald-500 focus:bg-white outline-none transition-all shadow-sm"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <p className="text-sm text-center text-slate-500 px-4">
                {t('seal.revenueStepHint')}
              </p>
              <div className="grid grid-cols-1 gap-3">
                <select
                  value={helperFormPayload.jobSize ?? 'medium'}
                  onChange={(e) => setHelperFormPayload((prev) => ({ ...prev, jobSize: e.target.value as HelperFormPayload['jobSize'] }))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  <option value="small">Job size: small</option>
                  <option value="medium">Job size: medium</option>
                  <option value="large">Job size: large</option>
                </select>
                <select
                  value={helperFormPayload.urgency ?? 'medium'}
                  onChange={(e) => setHelperFormPayload((prev) => ({ ...prev, urgency: e.target.value as HelperFormPayload['urgency'] }))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  <option value="low">Urgency: low</option>
                  <option value="medium">Urgency: medium</option>
                  <option value="high">Urgency: high</option>
                </select>
                <select
                  value={helperFormPayload.priceDiscussed ?? 'yes'}
                  onChange={(e) => setHelperFormPayload((prev) => ({ ...prev, priceDiscussed: e.target.value as HelperFormPayload['priceDiscussed'] }))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  <option value="yes">Price discussed: yes</option>
                  <option value="no">Price discussed: no</option>
                </select>
                <select
                  value={helperFormPayload.followupExpectation ?? 'yes'}
                  onChange={(e) => setHelperFormPayload((prev) => ({ ...prev, followupExpectation: e.target.value as HelperFormPayload['followupExpectation'] }))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  <option value="no">Follow-up expected: no</option>
                  <option value="uncertain">Follow-up expected: uncertain</option>
                  <option value="yes">Follow-up expected: yes</option>
                </select>
                <select
                  value={helperFormPayload.competitorComparison ?? 'no'}
                  onChange={(e) => setHelperFormPayload((prev) => ({ ...prev, competitorComparison: e.target.value as HelperFormPayload['competitorComparison'] }))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  <option value="yes">Competitor comparison: yes</option>
                  <option value="no">Competitor comparison: no</option>
                </select>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500 text-center">
              <div className="p-6 rounded-3xl bg-emerald-50 border-2 border-emerald-100 flex flex-col items-center gap-2">
                <ShieldCheck className="h-12 w-12 text-emerald-600 mb-2" />
                <div className="text-slate-500 text-xs font-bold uppercase tracking-widest leading-none">
                  {t('seal.valueToSealLabel')}
                </div>
                <div className="text-4xl font-black text-emerald-700 tracking-tighter">
                  {effectiveAmount ? `${effectiveAmount} ${currency}` : t('seal.aiEstimateLabel')}
                </div>
                {callerPhone && (
                  <div className="mt-4 px-4 py-2 rounded-full bg-white border border-emerald-200 text-emerald-700 text-sm font-mono font-bold">
                    {callerPhone}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="pt-6 border-t border-slate-100 pb-safe px-2">
          <div className="flex items-center justify-between w-full gap-4">
            {step === 1 ? (
              <Button
                variant="ghost"
                className="text-red-500 hover:bg-red-50 hover:text-red-600 font-bold"
                onClick={handleJunk}
                disabled={junking}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('seal.junk')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="text-slate-400 hover:text-slate-600 font-bold"
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
                disabled={saving}
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                {t('seal.back')}
              </Button>
            )}

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                className="font-bold border-slate-200 text-slate-500"
                onClick={() => onOpenChange(false)}
              >
                {t('seal.cancel')}
              </Button>
              
              {step < 3 ? (
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-8 py-6 rounded-2xl shadow-lg ring-offset-2 focus:ring-2 ring-emerald-500 transition-all hover:scale-105 active:scale-95"
                  onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
                >
                  {t('seal.next')}
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button
                  className={cn(
                    "bg-slate-900 hover:bg-black text-white font-black px-10 py-6 rounded-2xl shadow-xl transition-all hover:scale-105 active:scale-95",
                    sealSuccessPulse && "scale-110 bg-emerald-600"
                  )}
                  onClick={handleConfirm}
                  disabled={saving}
                >
                  {saving ? t('seal.sealing') : t('seal.send')}
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
