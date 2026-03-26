'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ConversationWorkbench } from './conversation-workbench';
import type { SiteRole } from '@/lib/auth/rbac';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function ConversationDeskShell({
  siteId,
  siteName,
  siteRole,
  currentUserId,
  title,
  subtitle,
  initialBucket = 'active',
}: {
  siteId: string;
  siteName?: string;
  siteRole: SiteRole;
  currentUserId?: string;
  title?: string;
  subtitle?: string;
  initialBucket?: 'active' | 'overdue' | 'today' | 'unassigned' | 'all';
}) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('crm.desk.title');
  const resolvedSubtitle = subtitle ?? t('crm.desk.subtitle');

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{resolvedTitle}</div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {siteName || 'OpsMantik'} {t('crm.desk.warRoom')}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">{resolvedSubtitle}</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link href={`/dashboard/site/${siteId}/today-desk`} className="w-full sm:w-auto">
              <Button variant="outline" className="w-full sm:w-auto">{t('dashboard.todayDesk')}</Button>
            </Link>
            <Link href={`/dashboard/site/${siteId}`} className="w-full sm:w-auto">
              <Button variant="outline" className="w-full sm:w-auto">{t('common.backToDashboard')}</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 pb-16 sm:px-6">
        <ConversationWorkbench
          siteId={siteId}
          siteRole={siteRole}
          currentUserId={currentUserId}
          title={resolvedTitle}
          description={resolvedSubtitle}
          initialBucket={initialBucket}
        />
      </main>
    </div>
  );
}
