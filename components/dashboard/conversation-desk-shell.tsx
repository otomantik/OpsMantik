'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ConversationWorkbench } from './conversation-workbench';
import type { SiteRole } from '@/lib/auth/rbac';

export function ConversationDeskShell({
  siteId,
  siteName,
  siteRole,
  currentUserId,
  title = 'Conversation Desk',
  subtitle = 'Dedicated operator surface for assignment, follow-up, timeline control, and evidence-driven execution.',
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
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{title}</div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {siteName || 'OpsMantik'} Conversation War Room
            </h1>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/dashboard/site/${siteId}/today-desk`}>
              <Button variant="outline">Today Desk</Button>
            </Link>
            <Link href={`/dashboard/site/${siteId}`}>
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 pb-16">
        <ConversationWorkbench
          siteId={siteId}
          siteRole={siteRole}
          currentUserId={currentUserId}
          title={title}
          description={subtitle}
          initialBucket={initialBucket}
        />
      </main>
    </div>
  );
}
