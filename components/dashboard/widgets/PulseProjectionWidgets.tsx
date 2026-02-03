'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCommandCenterP0Stats } from '@/lib/hooks/use-command-center-p0-stats';
import { TrendingUp, Activity, DollarSign, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PulseProjectionWidgetsProps {
    siteId: string;
    dateRange: { fromIso: string; toIso: string };
    scope: 'ads' | 'all';
}

export function PulseProjectionWidgets({ siteId, dateRange, scope }: PulseProjectionWidgetsProps) {
    const { stats, loading } = useCommandCenterP0Stats(siteId, dateRange, { scope });

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Card className="border-border bg-card">
                    <CardHeader className="p-4 pb-2">
                        <Skeleton className="h-4 w-32" />
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <Skeleton className="h-8 w-full" />
                    </CardContent>
                </Card>
                <Card className="border-border bg-card">
                    <CardHeader className="p-4 pb-2">
                        <Skeleton className="h-4 w-32" />
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <Skeleton className="h-8 w-full" />
                    </CardContent>
                </Card>
            </div>
        );
    }

    const revenue = stats?.projected_revenue ?? 0;
    const currency = stats?.currency || 'TRY';
    const sealed = stats?.sealed ?? 0;
    const pending = stats?.queue_pending ?? 0;

    // Fake "Pulse" logic for now: (sealed / total) * 100
    const total = sealed + pending;
    const pulseRate = total > 0 ? Math.round((sealed / total) * 100) : 0;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="executive-pulse">
            {/* Revenue Projection Card — masaüstü okunaklı */}
            <Card className="relative overflow-hidden border border-slate-200 bg-white shadow-sm">
                <div className="absolute right-0 top-0 h-24 w-24 -translate-y-8 translate-x-8 opacity-5">
                    <DollarSign className="h-full w-full" />
                </div>
                <CardHeader className="p-5 pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-600">
                        <TrendingUp className="h-4 w-4 text-blue-500" />
                        Revenue Projection
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold tabular-nums text-slate-900" suppressHydrationWarning>
                            {revenue.toLocaleString()}
                        </span>
                        <span className="text-base font-medium text-slate-500">{currency}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                        Based on {sealed} sealed deals in this period.
                    </p>
                </CardContent>
            </Card>

            {/* Conversion Pulse Card */}
            <Card className="relative overflow-hidden border border-slate-200 bg-white shadow-sm">
                <div className="absolute right-0 top-0 h-24 w-24 -translate-y-8 translate-x-8 opacity-5">
                    <Zap className="h-full w-full" />
                </div>
                <CardHeader className="p-5 pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-600">
                        <Activity className="h-4 w-4 text-emerald-500" />
                        Conversion Pulse
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                    <div className="flex items-center gap-3">
                        <div className="text-3xl font-bold tabular-nums text-slate-900">{pulseRate}%</div>
                        <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className={cn(
                                    "h-full transition-all duration-500 rounded-full",
                                    pulseRate > 50 ? "bg-emerald-500" : pulseRate > 20 ? "bg-amber-500" : "bg-blue-500"
                                )}
                                style={{ width: `${pulseRate}%` }}
                            />
                        </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                        {sealed} qualified / {total} total incoming intents.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
