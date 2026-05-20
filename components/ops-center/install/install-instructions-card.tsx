'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { TranslationKey } from '@/lib/i18n/t';

type MethodId = 'standard' | 'wordpress' | 'sharedHosting' | 'sst';

const METHODS: MethodId[] = ['standard', 'wordpress', 'sharedHosting', 'sst'];

function methodLabel(id: MethodId, t: (k: TranslationKey) => string): string {
  switch (id) {
    case 'standard':
      return t('panel.install.methods.standard');
    case 'wordpress':
      return t('panel.install.methods.wordpress');
    case 'sharedHosting':
      return t('panel.install.methods.sharedHosting');
    case 'sst':
      return t('panel.install.methods.sst');
  }
}

function methodBody(id: MethodId, t: (k: TranslationKey) => string): string {
  switch (id) {
    case 'standard':
      return t('panel.install.methods.standardBody');
    case 'wordpress':
      return t('panel.install.methods.wordpressBody');
    case 'sharedHosting':
      return t('panel.install.methods.sharedHostingBody');
    case 'sst':
      return t('panel.install.methods.sstBody');
  }
}

export function InstallInstructionsCard() {
  const { t } = useTranslation();
  const [active, setActive] = useState<MethodId>('standard');

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3">
        {t('panel.install.methods.title')}
      </h2>
      <div className="flex flex-wrap gap-2 mb-3">
        {METHODS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={cn(
              'px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wide border transition-colors',
              active === id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            )}
          >
            {methodLabel(id, t)}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">{methodBody(active, t)}</p>
    </section>
  );
}
