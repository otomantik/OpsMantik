'use client';

import { useMemo, useState, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useSfx } from '@/lib/hooks/use-sfx';

export interface SealModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  chipValues?: number[];
  /** Called when user saves: amount, currency, leadScore (always 100 for Golden Signal). */
  onConfirm: (saleAmount: number | null, currency: string, leadScore: number) => Promise<void>;
  /** Called when user clicks Junk: submit with score 0, status junk, then close. */
  onJunk?: () => Promise<void>;
  /** Called after successful Save (seal). */
  onSuccess?: () => void;
  /** Called after successful Junk. */
  onJunkSuccess?: () => void;
  onError?: (message: string) => void;
}

export function SealModal({
  open,
  onOpenChange,
  currency,
  onConfirm,
  onJunk,
  onSuccess,
  onJunkSuccess,
  onError,
}: SealModalProps) {
  const { t } = useTranslation();
  const [customAmount, setCustomAmount] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [junking, setJunking] = useState(false);
  const [sealSuccessPulse, setSealSuccessPulse] = useState(false);

  const sfxSrc = useMemo(() => '/sounds/cha-ching.mp3', []);
  const { play: playChaChing } = useSfx(sfxSrc);

  const customNum = customAmount.trim() ? Number(customAmount.trim()) : null;
  const effectiveAmount =
    customNum != null && !Number.isNaN(customNum) && customNum >= 0 ? customNum : null;
  const priceValid = effectiveAmount == null || (effectiveAmount >= 0 && Number.isFinite(effectiveAmount));
  const canSave = priceValid;

  const handleConfirm = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onConfirm(effectiveAmount ?? null, currency, 100);

      try {
        void playChaChing();
      } catch {
        // ignore
      }
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(50);
        }
      } catch {
        // ignore
      }
      setSealSuccessPulse(true);
      window.setTimeout(() => setSealSuccessPulse(false), 420);

      onSuccess?.();
      onOpenChange(false);
      setCustomAmount('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('seal.errorSeal');
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  }, [canSave, effectiveAmount, currency, onConfirm, onSuccess, onError, onOpenChange, playChaChing, t]);

  const handleJunk = useCallback(async () => {
    if (!onJunk) return;
    setJunking(true);
    try {
      await onJunk();
      onJunkSuccess?.();
      onOpenChange(false);
      setCustomAmount('');
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
        className="h-[min(85vh,480px)] flex flex-col bg-white dark:bg-white text-slate-950 dark:text-slate-950 border-t border-slate-200 rounded-t-2xl"
        data-testid="seal-modal"
      >
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2 text-xl font-semibold text-center">
            <ShieldCheck className="h-8 w-8 text-emerald-600" aria-hidden />
            {t('seal.title')}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <input
              type="text"
              inputMode="decimal"
              min={0}
              step={0.01}
              placeholder={t('seal.pricePlaceholder', { currency })}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              data-testid="seal-modal-custom-amount"
            />
            <p className="text-sm text-slate-600 mt-2">{t('seal.instruction')}</p>
          </div>
        </div>
        <SheetFooter className="flex-col sm:flex-row gap-3 pt-4 border-t border-slate-200 pb-safe">
          {onJunk && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full sm:w-auto text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300 font-medium min-h-[44px]"
              onClick={handleJunk}
              disabled={saving || junking}
              data-testid="seal-modal-junk"
            >
              <Trash2 className="h-4 w-4 mr-2" aria-hidden />
              {t('seal.junk')}
            </Button>
          )}
          <div className="flex gap-3 ml-auto w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1 sm:flex-none font-medium min-h-[44px]"
              onClick={() => {
                onOpenChange(false);
                setCustomAmount('');
              }}
            >
              {t('seal.cancel')}
            </Button>
            <Button
              type="button"
              size="lg"
              className={cn(
                'flex-1 sm:flex-none font-medium bg-emerald-600 hover:bg-emerald-700 text-white min-h-[44px] transition-transform duration-200',
                sealSuccessPulse && 'scale-[1.04]'
              )}
              disabled={!canSave || saving || junking}
              onClick={handleConfirm}
              data-testid="seal-modal-confirm"
            >
              <ShieldCheck className="h-4 w-4 mr-2" aria-hidden />
              {saving ? t('seal.sealing') : t('seal.button')}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
