'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import type { InstallReadinessState } from '@/lib/panel/install-status';
import type { TranslationKey } from '@/lib/i18n/t';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<InstallReadinessState, string> = {
  not_installed: 'bg-slate-100 text-slate-700 border-slate-200',
  installed_no_events: 'bg-amber-50 text-amber-800 border-amber-200',
  events_received: 'bg-sky-50 text-sky-800 border-sky-200',
  intent_events_received: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  conversion_ready: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  no_heartbeat: 'bg-amber-50 text-amber-800 border-amber-200',
  origin_mismatch: 'bg-red-50 text-red-800 border-red-200',
  consent_missing: 'bg-amber-50 text-amber-800 border-amber-200',
  script_outdated: 'bg-amber-50 text-amber-800 border-amber-200',
  unknown: 'bg-slate-100 text-slate-600 border-slate-200',
};

function statusLabel(state: InstallReadinessState, t: (k: TranslationKey) => string): string {
  switch (state) {
    case 'not_installed':
      return t('panel.install.status.notInstalled');
    case 'installed_no_events':
      return t('panel.install.status.installedNoEvents');
    case 'events_received':
      return t('panel.install.status.eventsReceived');
    case 'intent_events_received':
      return t('panel.install.status.intentEventsReceived');
    case 'conversion_ready':
      return t('panel.install.status.conversionReady');
    case 'no_heartbeat':
      return t('panel.install.status.noHeartbeat');
    case 'origin_mismatch':
      return t('panel.install.status.originMismatch');
    case 'consent_missing':
      return t('panel.install.status.consentMissing');
    case 'script_outdated':
      return t('panel.install.status.scriptOutdated');
    case 'unknown':
      return t('panel.install.status.unknown');
  }
}

export function InstallStatusBadge({ state }: { state: InstallReadinessState }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wide',
        STATUS_STYLE[state]
      )}
    >
      {statusLabel(state, t)}
    </span>
  );
}
