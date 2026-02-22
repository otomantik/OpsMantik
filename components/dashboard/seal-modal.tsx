'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Star, Trash2, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useSfx } from '@/lib/hooks/use-sfx';

export interface SealModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  chipValues: number[];
  /** Called when user saves: saleAmount can be null (lazy flow), leadScore is 1-5. */
  onConfirm: (saleAmount: number | null, currency: string, leadScore: number) => Promise<void>;
  /** Called when user clicks Junk: submit with score 0, status junk, then close. */
  onJunk?: () => Promise<void>;
  /** Called after successful Save (seal). */
  onSuccess?: () => void;
  /** Called after successful Junk. */
  onJunkSuccess?: () => void;
  onError?: (message: string) => void;
}

const DEFAULT_CHIPS = [1000, 5000, 10000, 25000];

export function SealModal({
  open,
  onOpenChange,
  currency,
  chipValues,
  onConfirm,
  onJunk,
  onSuccess,
  onJunkSuccess,
  onError,
}: SealModalProps) {
  const { t, formatNumber } = useTranslation();
  const chips = chipValues.length > 0 ? chipValues : DEFAULT_CHIPS;
  const [leadScore, setLeadScore] = useState<number>(0);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [junking, setJunking] = useState(false);
  const [muted, setMuted] = useState<boolean>(false);
  const [sealSuccessPulse, setSealSuccessPulse] = useState(false);
  const [starError, setStarError] = useState<string | null>(null);

  const sfxSrc = useMemo(() => '/sounds/cha-ching.mp3', []);
  const { play: playChaChing } = useSfx(sfxSrc);

  // Persist mute preference locally (per device/browser)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('opsmantik:sfx-muted');
      if (saved === '1') setMuted(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('opsmantik:sfx-muted', muted ? '1' : '0');
    } catch {
      // ignore
    }
  }, [muted]);

  const customNum = customAmount.trim() ? Number(customAmount.trim()) : null;
  const effectiveAmount =
    selectedAmount ?? (customNum != null && !Number.isNaN(customNum) && customNum >= 0 ? customNum : null);
  const priceValid = effectiveAmount == null || (effectiveAmount >= 0 && Number.isFinite(effectiveAmount));
  // Price is optional; we only validate it if provided.
  const canSave = priceValid;

  const handleConfirm = useCallback(async () => {
    if (!canSave) return;
    if (!(leadScore >= 1 && leadScore <= 5)) {
      setStarError('Please select a lead quality rating.');
      return;
    }
    setSaving(true);
    try {
      await onConfirm(effectiveAmount ?? null, currency, leadScore);

      // Gamification feedback (success only)
      try {
        if (!muted) void playChaChing();
      } catch {
        // ignore
      }
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          // light haptic
          (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(50);
        }
      } catch {
        // ignore
      }
      setSealSuccessPulse(true);
      window.setTimeout(() => setSealSuccessPulse(false), 420);

      onSuccess?.();
      onOpenChange(false);
      setLeadScore(0);
      setSelectedAmount(null);
      setCustomAmount('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to seal';
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  }, [canSave, effectiveAmount, currency, leadScore, muted, onConfirm, onSuccess, onError, onOpenChange, playChaChing]);

  const handleJunk = useCallback(async () => {
    if (!onJunk) return;
    setJunking(true);
    try {
      await onJunk();
      onJunkSuccess?.();
      onOpenChange(false);
      setLeadScore(0);
      setSelectedAmount(null);
      setCustomAmount('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to mark as junk';
      onError?.(msg);
    } finally {
      setJunking(false);
    }
  }, [onJunk, onJunkSuccess, onError, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(92vw,440px)] max-h-[85vh] overflow-y-auto bg-white dark:bg-white text-slate-950 dark:text-slate-950 border border-slate-200"
        data-testid="seal-modal"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="pb-2 relative">
          <DialogTitle className="text-xl font-semibold text-center">{t('seal.title')}</DialogTitle>
          <button
            type="button"
            className="absolute right-0 top-0 p-2 rounded-md text-slate-600 hover:bg-slate-100 transition-colors"
            onClick={() => setMuted((v) => !v)}
            aria-label={muted ? t('seal.unmute') : t('seal.mute')}
            title={muted ? t('seal.unmute') : t('seal.mute')}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {/* Star rating (mandatory) — top */}
          <div className="flex flex-col items-center">
            <p className="text-sm font-semibold text-slate-700 mb-3">{t('seal.starLabel')}</p>
            <div
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg px-2 py-1',
                starError && 'ring-2 ring-red-200'
              )}
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={t('seal.starAria', { star })}
                  className={cn(
                    'p-1.5 rounded-lg transition-all',
                    leadScore >= star
                      ? 'text-amber-500 hover:text-amber-600 hover:scale-110'
                      : 'text-slate-300 hover:text-slate-400 hover:scale-105'
                  )}
                  onClick={() => {
                    setLeadScore(star);
                    if (starError) setStarError(null);
                  }}
                >
                  <Star
                    className={cn('h-10 w-10', leadScore >= star ? 'fill-amber-500' : 'fill-transparent')}
                    strokeWidth={1.5}
                  />
                </button>
              ))}
            </div>
            {leadScore >= 4 && (
              <p className="text-sm font-medium text-emerald-600 mt-2.5">{t('seal.starQualified')}</p>
            )}
            {starError && (
              <p className="text-sm font-medium text-red-600 mt-2">{starError}</p>
            )}
          </div>

          {/* Price (optional) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <div className="mb-2">
              <label className="text-sm font-semibold text-slate-700">{t('seal.priceLabel')}</label>
              <p className="text-xs text-slate-500 mt-1">{t('seal.priceHelper')}</p>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 justify-center">
                {chips.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={selectedAmount === value ? 'default' : 'outline'}
                    size="sm"
                    className={cn(
                      'min-w-[80px] font-medium',
                      selectedAmount === value && 'ring-2 ring-primary ring-offset-2'
                    )}
                    onClick={() => {
                      setSelectedAmount(value);
                      setCustomAmount('');
                    }}
                  >
                    <span suppressHydrationWarning>{formatNumber(value)} {currency}</span>
                  </Button>
                ))}
              </div>
              <input
                type="number"
                min={0}
                step={1}
                placeholder={t('seal.pricePlaceholder')}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-950 placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setSelectedAmount(null);
                }}
                data-testid="seal-modal-custom-amount"
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-3 pt-4 border-t border-slate-200">
          {onJunk && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full sm:w-auto text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300 font-medium"
              onClick={handleJunk}
              disabled={saving || junking}
              data-testid="seal-modal-junk"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('seal.junk')}
            </Button>
          )}
          <div className="flex gap-3 ml-auto w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1 sm:flex-none font-medium"
              onClick={() => {
                onOpenChange(false);
                setSelectedAmount(null);
                setCustomAmount('');
              }}
            >
              {t('seal.cancel')}
            </Button>
            <Button
              type="button"
              size="lg"
              className={cn(
                'flex-1 sm:flex-none font-medium transition-transform duration-200',
                sealSuccessPulse && 'scale-[1.04]'
              )}
              disabled={!canSave || saving || junking}
              onClick={handleConfirm}
              data-testid="seal-modal-confirm"
            >
              {saving ? t('seal.sealing') : t('seal.confirm')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
