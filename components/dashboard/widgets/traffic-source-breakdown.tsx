'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useTrafficSourceBreakdown } from '@/lib/hooks/use-traffic-source-breakdown';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

const COLORS = [
  'hsl(220 70% 50%)', // blue
  'hsl(160 60% 45%)', // green
  'hsl(35 90% 55%)',  // amber
  'hsl(280 60% 55%)', // purple
  'hsl(10 70% 55%)',  // red
  'hsl(200 50% 50%)', // cyan
];

function sumByNames(rows: Array<{ name: string; count: number }>, names: string[]): number {
  const set = new Set(names.map((n) => n.toLowerCase()));
  return rows.reduce((acc, r) => acc + (set.has(String(r.name).toLowerCase()) ? r.count : 0), 0);
}

export function TrafficSourceBreakdown({
  siteId,
  dateRange,
}: {
  siteId: string;
  dateRange: { from: string; to: string };
}) {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useTrafficSourceBreakdown(siteId, {
    from: dateRange.from,
    to: dateRange.to,
  });

  const total = data?.total_sessions ?? 0;
  const sources = data?.sources ?? [];

  const rollup = useMemo(() => {
    // Roll up into non-technical buckets.
    const googleAds = sumByNames(sources, ['Google Ads']);
    const seo = sumByNames(sources, ['SEO']);
    const social = sumByNames(sources, [
      'Meta Ads',
      'TikTok Ads',
      'Facebook',
      'Instagram',
      'X',
      'LinkedIn',
      'TikTok',
      'YouTube',
    ]);
    const direct = sumByNames(sources, ['Direct']);
    const referral = sumByNames(sources, ['Referral']);

    const known = googleAds + seo + social + direct + referral;
    const other = Math.max(0, total - known);

    const rows = [
      { name: t('dimension.googleAds'), count: googleAds },
      { name: t('dimension.seo'), count: seo },
      { name: t('dimension.social'), count: social },
      { name: t('dimension.direct'), count: direct },
      { name: t('dimension.referral'), count: referral },
      { name: t('dimension.other'), count: other },
    ].filter((r) => r.count > 0 || total === 0);

    return { googleAds, seo, social, direct, referral, other, rows };
  }, [sources, total, t]);

  const pieData = useMemo(() => rollup.rows.filter((r) => r.count > 0), [rollup.rows]);

  const insight = useMemo(() => {
    if (total <= 0) return null;
    if (rollup.googleAds === 0 && rollup.seo >= Math.max(3, Math.ceil(total * 0.4))) {
      return 'Organic (SEO) is driving the business today. Keep an eye on Google Ads campaigns.';
    }
    return null;
  }, [rollup.googleAds, rollup.seo, total]);

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="traffic-source-breakdown">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">{t('traffic.title')}</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-slate-200 bg-white">
              <CardHeader className="p-4 pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <Skeleton className="h-7 w-14" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <Skeleton className="h-[180px] w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3" data-testid="traffic-source-breakdown">
        <h3 className="text-base font-semibold text-slate-800">{t('traffic.title')}</h3>
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <p className="text-sm text-rose-700">{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
              {t('button.retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="space-y-3" data-testid="traffic-source-breakdown">
        <h3 className="text-base font-semibold text-slate-800">{t('traffic.title')}</h3>
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">{t('traffic.noSessionsInRange')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3 min-w-0" data-testid="traffic-source-breakdown">
      <div>
        <h3 className="text-base font-semibold text-slate-800">{t('traffic.title')}</h3>
        <p className="text-xs text-slate-500 uppercase tracking-wider mt-1">{t('traffic.whereVisitorsCameFrom')}</p>
      </div>

      {insight && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span className="font-semibold">{t('traffic.insightLabel')}</span> {insight}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: t('dimension.googleAds'), value: rollup.googleAds },
          { label: t('dimension.seo'), value: rollup.seo },
          { label: t('dimension.social'), value: rollup.social },
        ].map((c) => (
          <Card key={c.label} className="border-slate-200 bg-white">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">{c.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold tabular-nums text-slate-900">{c.value}</div>
              <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                {Math.round((c.value * 100) / Math.max(1, total))}% {t('common.ofTraffic')}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-200 bg-white">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div className="min-w-0 w-full h-[180px]">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={1}
                  >
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} stroke="transparent" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-2 min-w-0">
              {pieData.map((r, idx) => (
                <div key={r.name} className="flex items-center justify-between gap-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                    />
                    <span className="text-sm font-medium text-slate-700 truncate">{r.name}</span>
                  </div>
                  <div className={cn('text-sm font-semibold tabular-nums text-slate-900 shrink-0')}>
                    {r.count}
                    <span className="text-xs text-slate-400 font-medium ml-2">
                      {Math.round((r.count * 100) / Math.max(1, total))}%
                    </span>
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>{t('traffic.total')}</span>
                <span className="tabular-nums font-semibold text-slate-700">{total}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

