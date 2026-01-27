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
      className="w-full text-left px-3 py-2 text-xs font-mono text-slate-300 hover:bg-slate-800/50 rounded transition-colors"
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
        className="bg-slate-800/60 border-slate-700/50 text-slate-200 hover:bg-slate-700/60 font-mono text-xs h-8 px-3"
      >
        <Calendar className="w-3 h-3 mr-2" />
        {displayText}
        <ChevronDown className={`w-3 h-3 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <Card className="absolute right-0 top-full mt-2 z-50 w-80 bg-slate-900 border-slate-800/50 shadow-xl">
            <CardContent className="p-4">
              {/* Presets */}
              <div className="space-y-1 mb-4">
                <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-2">
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
              <div className="pt-4 border-t border-slate-800/50">
                <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-2">
                  Özel Tarih Aralığı
                </p>
                <p className="text-[11px] font-mono text-slate-400 italic">
                  Tarih seçici yakında eklenecek
                </p>
              </div>

              {/* Current Range Display */}
              <div className="pt-4 border-t border-slate-800/50 mt-4">
                <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1">
                  Seçili Aralık
                </p>
                <p className="text-[11px] font-mono text-slate-300">
                  {displayText} (TRT)
                </p>
                <p className="text-[9px] font-mono text-slate-500 mt-1">
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
