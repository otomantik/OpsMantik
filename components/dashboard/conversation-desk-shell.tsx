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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{resolvedTitle}</div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {siteName || 'OpsMantik'} {t('crm.desk.warRoom')}
            </h1>
            <p className="mt-1 text-sm text-slate-500">{resolvedSubtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/dashboard/site/${siteId}/today-desk`}>
              <Button variant="outline">{t('dashboard.todayDesk')}</Button>
            </Link>
            <Link href={`/dashboard/site/${siteId}`}>
              <Button variant="outline">{t('common.backToDashboard')}</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 pb-16">
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
