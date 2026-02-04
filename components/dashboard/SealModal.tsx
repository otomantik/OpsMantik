'use client';

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Star, Trash2 } from 'lucide-react';
import { strings } from '@/lib/i18n/en';

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
  const chips = chipValues.length > 0 ? chipValues : DEFAULT_CHIPS;
  const [leadScore, setLeadScore] = useState<number>(0);
  const [showPrice, setShowPrice] = useState<boolean>(false);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [junking, setJunking] = useState(false);

  const customNum = customAmount.trim() ? Number(customAmount.trim()) : null;
  const effectiveAmount =
    selectedAmount ?? (customNum != null && !Number.isNaN(customNum) && customNum >= 0 ? customNum : null);
  const priceValid = effectiveAmount == null || (effectiveAmount >= 0 && Number.isFinite(effectiveAmount));
  const canSave = leadScore >= 1 && leadScore <= 5 && priceValid;

  const handleConfirm = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onConfirm(effectiveAmount ?? null, currency, leadScore);
      onSuccess?.();
      onOpenChange(false);
      setLeadScore(0);
      setShowPrice(false);
      setSelectedAmount(null);
      setCustomAmount('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to seal';
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  }, [canSave, effectiveAmount, currency, leadScore, onConfirm, onSuccess, onError, onOpenChange]);

  const handleJunk = useCallback(async () => {
    if (!onJunk) return;
    setJunking(true);
    try {
      await onJunk();
      onJunkSuccess?.();
      onOpenChange(false);
      setLeadScore(0);
      setShowPrice(false);
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
        <DialogHeader className="pb-2">
          <DialogTitle className="text-xl font-semibold text-center">{strings.sealModalTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {/* Star rating (mandatory) — top */}
          <div className="flex flex-col items-center">
            <p className="text-sm font-semibold text-slate-700 mb-3">{strings.sealModalStarLabel}</p>
            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`${star} star`}
                  className={cn(
                    'p-1.5 rounded-lg transition-all',
                    leadScore >= star
                      ? 'text-amber-500 hover:text-amber-600 hover:scale-110'
                      : 'text-slate-300 hover:text-slate-400 hover:scale-105'
                  )}
                  onClick={() => setLeadScore(star)}
                >
                  <Star
                    className={cn('h-10 w-10', leadScore >= star ? 'fill-amber-500' : 'fill-transparent')}
                    strokeWidth={1.5}
                  />
                </button>
              ))}
            </div>
            {leadScore >= 4 && (
              <p className="text-sm font-medium text-emerald-600 mt-2.5">{strings.sealModalStarQualified}</p>
            )}
          </div>

          {/* Price (optional) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <label className="text-sm font-semibold text-slate-700">{strings.sealModalPriceLabel}</label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-xs font-medium hover:bg-slate-100"
                onClick={() => {
                  setShowPrice((v) => {
                    const next = !v;
                    // When hiding, clear entered price to keep the "lazy" flow clean.
                    if (!next) {
                      setSelectedAmount(null);
                      setCustomAmount('');
                    }
                    return next;
                  });
                }}
              >
                {showPrice ? strings.sealModalHidePrice : strings.sealModalAddPrice}
              </Button>
            </div>

            {showPrice && (
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
                      <span suppressHydrationWarning>{value.toLocaleString()} {currency}</span>
                    </Button>
                  ))}
                </div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder={strings.sealModalPricePlaceholder}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-950 placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    setSelectedAmount(null);
                  }}
                  data-testid="seal-modal-custom-amount"
                />
              </div>
            )}
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
              {strings.sealModalJunk}
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
                setShowPrice(false);
                setSelectedAmount(null);
                setCustomAmount('');
              }}
            >
              {strings.sealModalCancel}
            </Button>
            <Button
              type="button"
              size="lg"
              className="flex-1 sm:flex-none font-medium"
              disabled={!canSave || saving || junking}
              onClick={handleConfirm}
              data-testid="seal-modal-confirm"
            >
              {saving ? strings.sealModalSealing : strings.sealModalConfirm}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
