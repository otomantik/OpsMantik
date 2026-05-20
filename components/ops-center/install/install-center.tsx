'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { panelOciPath, panelSitePath } from '@/lib/auth/site-operational-route';
import type { InstallSiteSnapshot } from '@/lib/panel/load-install-snapshot';
import { TrackerSnippetCard } from './tracker-snippet-card';
import { InstallInstructionsCard } from './install-instructions-card';
import { SiteHealthCard } from './site-health-card';

export function InstallCenter({
  siteId,
  snapshot,
  locale,
}: {
  siteId: string;
  snapshot: InstallSiteSnapshot;
  locale: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">{t('panel.install.subtitle')}</p>

      <TrackerSnippetCard siteId={siteId} sitePublicId={snapshot.sitePublicId} />
      <InstallInstructionsCard />
      <SiteHealthCard snapshot={snapshot} locale={locale} />

      <nav className="flex flex-wrap gap-2 pt-2">
        <Link
          href={panelSitePath(siteId)}
          className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-200 bg-white text-[10px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50"
        >
          {t('panel.install.actions.backToPanel')}
        </Link>
        <Link
          href={panelOciPath(siteId)}
          className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-900 bg-slate-900 text-[10px] font-black uppercase tracking-wide text-white hover:bg-slate-800"
        >
          {t('panel.install.actions.openOci')}
        </Link>
        <a
          href={`/dashboard/site/${encodeURIComponent(siteId)}`}
          className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-200 bg-white text-[10px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50"
        >
          {t('panel.install.actions.siteSettings')}
        </a>
      </nav>
    </div>
  );
}
