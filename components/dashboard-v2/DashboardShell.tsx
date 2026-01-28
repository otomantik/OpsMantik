'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardHeaderV2 } from './DashboardHeaderV2';
import { KPICardsV2 } from './KPICardsV2';
import { QualificationQueue } from './QualificationQueue';
import { LiveInbox } from '@/components/dashboard/live-inbox';
import { Card, CardContent } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import './reset.css';

interface DashboardShellProps {
  siteId: string;
  siteName?: string;
  siteDomain?: string;
}

export function DashboardShell({ siteId, siteName, siteDomain }: DashboardShellProps) {
  const [activeTab, setActiveTab] = useState('queue');

  return (
    <div className="om-dashboard-reset min-h-screen bg-muted/40">
      <div className="flex min-h-screen">
        {/* Desktop Sidebar (shadcn-style) */}
        <aside className="hidden md:flex w-64 flex-col border-r border-border bg-background">
          <div className="px-4 py-4 border-b border-border">
            <div className="text-sm font-semibold truncate">{siteName || siteDomain || 'Ads Command Center'}</div>
            <div className="text-sm text-muted-foreground truncate">Qualification workflow</div>
          </div>

          <nav className="p-3 space-y-1">
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={[
                'w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                activeTab === 'queue'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              ].join(' ')}
            >
              <Icons.circleDot className="w-4 h-4" />
              Qualification Queue
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('stream')}
              className={[
                'w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                activeTab === 'stream'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              ].join(' ')}
            >
              <Icons.trendingUp className="w-4 h-4" />
              Live Stream
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className={[
                'w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                activeTab === 'analytics'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              ].join(' ')}
            >
              <Icons.barChart className="w-4 h-4" />
              Analytics
            </button>
          </nav>
        </aside>

        {/* Main Area */}
        <div className="flex-1 min-w-0">
          {/* Header with Realtime Pulse */}
          <DashboardHeaderV2 siteId={siteId} siteName={siteName} siteDomain={siteDomain} />

          <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 space-y-6">
            {/* KPI Cards (Always Visible - Today's Data) */}
            <KPICardsV2 siteId={siteId} />

            {/* Mobile Tabs (keep for small screens) */}
            <div className="md:hidden">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="queue" className="text-sm flex items-center gap-2">
                    <Icons.circleDot className="w-4 h-4" />
                    Queue
                  </TabsTrigger>
                  <TabsTrigger value="stream" className="text-sm flex items-center gap-2">
                    <Icons.trendingUp className="w-4 h-4" />
                    Stream
                  </TabsTrigger>
                  <TabsTrigger value="analytics" className="text-sm flex items-center gap-2">
                    <Icons.barChart className="w-4 h-4" />
                    Analytics
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Content Panels */}
            {activeTab === 'queue' && (
              <div className="space-y-4">
                <QualificationQueue siteId={siteId} />
              </div>
            )}

            {activeTab === 'stream' && (
              <div className="space-y-4">
                <LiveInbox siteId={siteId} />
              </div>
            )}

            {activeTab === 'analytics' && (
              <div className="space-y-4">
                <Card className="border-2 border-dashed border-border bg-background">
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <Icons.barChart className="w-12 h-12 text-muted-foreground mb-3" />
                    <h3 className="text-lg font-semibold mb-1">Analytics Coming Soon</h3>
                    <p className="text-sm text-muted-foreground max-w-md">
                      Timeline charts, breakdown widgets, and trend analysis will appear here.
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
