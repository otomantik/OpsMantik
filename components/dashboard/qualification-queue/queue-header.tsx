'use client';

import React from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function QueueHeader({
  queueMeta,
  toast,
  day,
}: {
  queueMeta: React.ReactNode;
  toast?: React.ReactNode;
  day: 'today' | 'yesterday';
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 space-y-3">
      {queueMeta}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-900">{t('dashboard.queue.title')}</div>
            <p className="mt-1 text-sm text-slate-500">{t('dashboard.queue.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
              {day === 'today' ? t('dashboard.queue.todayWindow') : t('dashboard.queue.yesterdayWindow')}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
              {t('dashboard.queue.refreshHint')}
            </span>
          </div>
        </div>
      </div>
      {toast ? <div className="mt-3">{toast}</div> : null}
    </div>
  );
}

