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

export interface SealModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  chipValues: number[];
  onConfirm: (saleAmount: number, currency: string) => Promise<void>;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

const DEFAULT_CHIPS = [1000, 5000, 10000, 25000];

export function SealModal({
  open,
  onOpenChange,
  currency,
  chipValues,
  onConfirm,
  onSuccess,
  onError,
}: SealModalProps) {
  const chips = chipValues.length > 0 ? chipValues : DEFAULT_CHIPS;
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const effectiveAmount = selectedAmount ?? (customAmount.trim() ? Number(customAmount.trim()) : null);
  const isValid = effectiveAmount != null && !Number.isNaN(effectiveAmount) && effectiveAmount >= 0;

  const handleConfirm = useCallback(async () => {
    if (!isValid || effectiveAmount == null) return;
    setSaving(true);
    try {
      await onConfirm(effectiveAmount, currency);
      onSuccess?.();
      onOpenChange(false);
      setSelectedAmount(null);
      setCustomAmount('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to seal';
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  }, [effectiveAmount, currency, isValid, onConfirm, onSuccess, onError, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(92vw,400px)] max-h-[85vh] overflow-y-auto bg-white dark:bg-white text-slate-950 dark:text-slate-950 border border-slate-200"
        data-testid="seal-modal"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">Seal deal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-slate-500">
            Choose amount or enter custom value ({currency}).
          </p>
          {/* Chips */}
          <div className="flex flex-wrap gap-2">
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
                {value.toLocaleString()} {currency}
              </Button>
            ))}
          </div>
          {/* Custom amount */}
          <div>
            <label className="text-xs font-medium text-slate-700">Custom amount</label>
            <input
              type="number"
              min={0}
              step={1}
              placeholder="0"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
              value={customAmount}
              onChange={(e) => {
                setCustomAmount(e.target.value);
                setSelectedAmount(null);
              }}
              data-testid="seal-modal-custom-amount"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!isValid || saving}
            onClick={handleConfirm}
            data-testid="seal-modal-confirm"
          >
            {saving ? 'Sealing…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
