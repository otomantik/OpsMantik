/**
 * Date Range Picker Component
 * 
 * Displays date range selector with presets and custom range.
 * Shows dates in TRT (Europe/Istanbul) timezone.
 */

'use client';

import { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DateRange } from '@/lib/hooks/use-dashboard-date-range';
import { formatTimestamp } from '@/lib/utils';

interface DateRangePickerProps {
  value: DateRange;
  onSelect: (range: DateRange) => void;
  onPresetSelect?: (presetValue: string) => void;
  presets: Array<{ label: string; value: string }>;
  timezone?: string;
  maxRange?: number; // Max days
}

function PresetButton({
  preset,
  onSelect,
}: {
  preset: { label: string; value: string };
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted rounded transition-colors"
    >
      {preset.label}
    </button>
  );
}

export function DateRangePicker({
  value,
  onSelect,
  onPresetSelect,
  presets,
  timezone = 'Europe/Istanbul',
  maxRange = 180,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const formatDate = (date: Date): string => {
    return formatTimestamp(date.toISOString(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const displayText = `${formatDate(value.from)} - ${formatDate(value.to)}`;

  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full sm:w-auto justify-between bg-background border-border text-foreground hover:bg-muted text-sm h-10 px-3"
      >
        <Calendar className="w-3.5 h-3.5 mr-2" />
        {displayText}
        <ChevronDown className={`w-3.5 h-3.5 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <Card className="absolute right-0 top-full mt-2 z-50 w-80 bg-popover text-popover-foreground border border-border shadow-lg">
            <CardContent className="p-4">
              {/* Presets */}
              <div className="space-y-1 mb-4">
                <p className="text-sm text-muted-foreground uppercase tracking-widest mb-2">
                  Hızlı Seçim
                </p>
                {presets.map((preset) => (
                  <PresetButton
                    key={preset.value}
                    preset={preset}
                    onSelect={() => {
                      if (onPresetSelect) {
                        onPresetSelect(preset.value);
                      }
                      setIsOpen(false);
                    }}
                  />
                ))}
              </div>

              {/* Custom Range (Placeholder) */}
              <div className="pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground uppercase tracking-widest mb-2">
                  Özel Tarih Aralığı
                </p>
                <p className="text-sm text-muted-foreground italic">
                  Tarih seçici yakında eklenecek
                </p>
              </div>

              {/* Current Range Display */}
              <div className="pt-4 border-t border-border mt-4">
                <p className="text-sm text-muted-foreground uppercase tracking-widest mb-1">
                  Seçili Aralık
                </p>
                <p className="text-sm tabular-nums">
                  {displayText} (TRT)
                </p>
                <p className="text-sm text-muted-foreground mt-1 tabular-nums">
                  Max: {maxRange} gün
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
