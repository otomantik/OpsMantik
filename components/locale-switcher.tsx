'use client';

import { useTransition } from 'react';
import { setUserLocale } from '@/app/actions/locale';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

const LOCALES = [
  { code: 'en', label: 'EN' },
  { code: 'tr', label: 'TR' },
  { code: 'it', label: 'IT' },
] as const;

export function LocaleSwitcher() {
  const { locale } = useTranslation();
  const [isPending, startTransition] = useTransition();

  const currentBase = locale.split('-')[0]?.toLowerCase() || 'en';

  const handleSelect = (code: string) => {
    if (code === currentBase) return;
    startTransition(async () => {
      await setUserLocale(code);
    });
  };

  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
      {LOCALES.map(({ code, label }) => {
        const isActive = currentBase === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => handleSelect(code)}
            disabled={isPending}
            className={cn(
              'px-2 py-1 text-xs font-bold uppercase tracking-wider rounded-md transition-colors',
              isActive
                ? 'bg-background text-foreground shadow-sm border border-border'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
              isPending && 'opacity-70 cursor-wait'
            )}
            aria-pressed={isActive}
            aria-label={`Switch to ${label}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
