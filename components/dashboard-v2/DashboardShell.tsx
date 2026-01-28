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
    <div className="om-dashboard-reset min-h-screen bg-background">
      {/* Header with Realtime Pulse */}
      <DashboardHeaderV2 siteId={siteId} siteName={siteName} siteDomain={siteDomain} />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* KPI Cards (Always Visible - Today's Data) */}
        <KPICardsV2 siteId={siteId} />

        {/* Tab Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 lg:w-auto">
            <TabsTrigger value="queue" className="text-sm flex items-center gap-2">
              <Icons.circleDot className="w-4 h-4" />
              Qualification Queue
            </TabsTrigger>
            <TabsTrigger value="stream" className="text-sm flex items-center gap-2">
              <Icons.trendingUp className="w-4 h-4" />
              Live Stream
            </TabsTrigger>
            <TabsTrigger value="analytics" className="text-sm flex items-center gap-2">
              <Icons.barChart className="w-4 h-4" />
              Analytics
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Qualification Queue */}
          <TabsContent value="queue" className="space-y-4">
            <QualificationQueue siteId={siteId} />
          </TabsContent>

          {/* Tab 2: Live Stream */}
          <TabsContent value="stream" className="space-y-4">
            <LiveInbox siteId={siteId} />
          </TabsContent>

          {/* Tab 3: Analytics (Placeholder) */}
          <TabsContent value="analytics" className="space-y-4">
            <Card className="border-2 border-dashed border-border bg-muted/20">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Icons.barChart className="w-16 h-16 text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">Analytics Coming Soon</h3>
                <p className="text-muted-foreground max-w-md">
                  Timeline charts, breakdown widgets, and trend analysis will appear here.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
