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
        className="max-w-[min(92vw,400px)] max-h-[85vh] overflow-y-auto bg-white dark:bg-white text-slate-950 dark:text-slate-950 border border-slate-200"
        data-testid="seal-modal"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">{strings.sealModalTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Star rating (mandatory) — top */}
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">{strings.sealModalStarLabel}</p>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`${star} star`}
                  className={cn(
                    'p-1 rounded transition-colors',
                    leadScore >= star
                      ? 'text-amber-500 hover:text-amber-600'
                      : 'text-slate-300 hover:text-slate-400'
                  )}
                  onClick={() => setLeadScore(star)}
                >
                  <Star
                    className={cn('h-8 w-8', leadScore >= star ? 'fill-amber-500' : 'fill-transparent')}
                    strokeWidth={1.5}
                  />
                </button>
              ))}
            </div>
            {leadScore >= 4 && (
              <p className="text-xs font-medium text-emerald-600 mt-1">{strings.sealModalStarQualified}</p>
            )}
          </div>

          {/* Price (optional) */}
          <div>
            <label className="text-xs font-medium text-slate-700">{strings.sealModalPriceLabel}</label>
            <div className="flex flex-wrap gap-2 mt-1 mb-2">
              {chips.map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={selectedAmount === value ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'min-w-[72px]',
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
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
              value={customAmount}
              onChange={(e) => {
                setCustomAmount(e.target.value);
                setSelectedAmount(null);
              }}
              data-testid="seal-modal-custom-amount"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
          {onJunk && (
            <Button
              type="button"
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
              onClick={handleJunk}
              disabled={saving || junking}
              data-testid="seal-modal-junk"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {strings.sealModalJunk}
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {strings.sealModalCancel}
            </Button>
            <Button
              type="button"
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
