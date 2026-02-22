'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, TrendingUp, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface CROInsightsProps {
    metrics: {
        peak_call_hour: number;
        avg_gclid_session_duration: number;
        total_calls: number;
    } | null;
    loading: boolean;
}

export function CROInsights({ metrics, loading }: CROInsightsProps) {
    const { t } = useTranslation();
    if (loading) {
        return <Skeleton className="h-[200px] w-full bg-slate-100/50" />;
    }

    if (!metrics) return null;

    const peakHourStr = `${metrics.peak_call_hour.toString().padStart(2, '0')}:00`;

    return (
        <div className="grid gap-4 md:grid-cols-3">
            {/* PEAK CONVERSION TIME */}
            <Card className="border-l-4 border-l-amber-500 shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                        {t('cro.peakIntentHour')}
                    </CardTitle>
                    <Clock className="w-4 h-4 text-amber-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-slate-900">{peakHourStr}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                        {t('cro.highestActivity')}
                    </p>
                </CardContent>
            </Card>

            {/* GCLID PERFORMANCE */}
            <Card className="border-l-4 border-l-blue-500 shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                        {t('cro.adsSessionAvg')}
                    </CardTitle>
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-slate-900">{metrics.avg_gclid_session_duration}s</div>
                    <p className="text-xs text-muted-foreground mt-1">
                        {t('cro.engagementTime')}
                    </p>
                </CardContent>
            </Card>

            {/* AI RECOMMENDATION (Dynamic based on data) */}
            <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/30 shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-bold text-emerald-700">
                        {t('cro.croAction')}
                    </CardTitle>
                    <AlertCircle className="w-4 h-4 text-emerald-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-xs font-semibold text-emerald-800 leading-relaxed">
                        {t('cro.suggestionSticky', { peakHour: peakHourStr })}
                    </div>
                    <div className="mt-2 text-[10px] text-emerald-600 font-medium">
                        {t('cro.basedOnEvents', { n: metrics.total_calls })}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
