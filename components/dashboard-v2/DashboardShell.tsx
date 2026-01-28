'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { LiveInbox } from '@/components/dashboard/live-inbox';
import './reset.css';

interface DashboardShellProps {
  siteId: string;
  siteName?: string;
  siteDomain?: string;
}

export function DashboardShell({ siteId, siteName, siteDomain }: DashboardShellProps) {
  return (
    <div className="om-dashboard-reset min-h-screen bg-background">
      {/* Minimal Header */}
      <header className="border-b border-border bg-background sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/dashboard">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold truncate">
                  {siteName || siteDomain || 'Site Dashboard'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Ads Command Center
                </p>
              </div>
              <Badge className="bg-amber-100 text-amber-800 border-amber-200 shrink-0">
                ADS ONLY
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Reuse existing LiveInbox component (proven, stable) */}
        <LiveInbox siteId={siteId} />

        {/* Today/Stats section (placeholder for now) */}
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground text-center">
              📊 Today's KPIs and Timeline coming soon...
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
