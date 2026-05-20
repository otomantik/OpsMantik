'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import type { TranslationKey } from '@/lib/i18n/t';
import type { InstallSiteSnapshot } from '@/lib/panel/load-install-snapshot';
import { deriveInstallReadiness } from '@/lib/panel/install-status';
import { InstallStatusBadge } from './install-status-badge';

function formatTs(value: string | null, locale: string): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(locale);
  } catch {
    return '—';
  }
}

function yesNoUnknown(value: boolean | null, t: (k: TranslationKey) => string): string {
  if (value === true) return t('panel.install.health.yes');
  if (value === false) return t('panel.install.health.no');
  return t('panel.install.health.unknown');
}

export function SiteHealthCard({ snapshot, locale }: { snapshot: InstallSiteSnapshot; locale: string }) {
  const { t } = useTranslation();
  const readiness = deriveInstallReadiness(snapshot);

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
          {t('panel.install.health.title')}
        </h2>
        <InstallStatusBadge state={readiness} />
      </div>
      <dl className="grid grid-cols-1 gap-2 text-xs">
        <Row label={t('panel.install.health.trackerInstalled')} value={yesNoUnknown(snapshot.lastEventAt !== null, t)} />
        <Row
          label={t('panel.install.health.lastHeartbeat')}
          value={formatTs(snapshot.lastHeartbeatAt, locale)}
        />
        <Row label={t('panel.install.health.lastEvent')} value={formatTs(snapshot.lastEventAt, locale)} />
        <Row label={t('panel.install.health.originVerified')} value={yesNoUnknown(snapshot.originVerified, t)} />
        <Row
          label={t('panel.install.health.scriptVersion')}
          value={snapshot.scriptVersion ?? t('panel.install.health.unknown')}
        />
        <Row label={t('panel.install.health.consent')} value={t('panel.install.health.consentDefault')} />
        <Row label={t('panel.install.health.domain')} value={snapshot.siteDomain ?? t('panel.install.health.unknown')} />
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400 shrink-0">{label}</dt>
      <dd className="text-[11px] font-semibold text-slate-800 text-right truncate">{value}</dd>
    </div>
  );
}
