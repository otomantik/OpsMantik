'use client';

import { useEffect, useState } from 'react';
import { FeatureGuard } from '@/components/feature-guard';
import { UpsellUI } from '@/components/upsell-ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface SpendRow {
  id: string;
  campaign_id: string;
  campaign_name: string;
  cost_cents: number;
  clicks: number;
  impressions: number;
  spend_date: string;
  updated_at?: string;
}

interface AdSpendWidgetProps {
  siteId: string;
}

function formatCost(cents: number): string {
  const value = cents / 100;
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate + 'T00:00:00Z');
    return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  } catch {
    return isoDate;
  }
}

export function AdSpendWidget({ siteId }: AdSpendWidgetProps) {
  const { t, formatTimestamp } = useTranslation();
  const [data, setData] = useState<{ data: SpendRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/dashboard/spend?siteId=${encodeURIComponent(siteId)}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 403 ? t('adSpend.moduleNotEnabled') : t('adSpend.error'));
          setLoading(false);
          return;
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        if (!cancelled) setError(t('adSpend.error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [siteId]);

  return (
    <FeatureGuard
      requiredModule="google_ads_spend"
      fallback={<UpsellUI title={t('adSpend.upsellTitle')} description={t('adSpend.upsellDescription')} ctaLabel={t('adSpend.upsellCtaLabel')} />}
    >
      <Card className="border-l-4 border-l-blue-500 shadow-sm hover:shadow-md transition-shadow rounded-xl overflow-hidden">
        <CardHeader className="pb-2 p-5">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-slate-600">{t('adSpend.title')}</CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-1">{t('adSpend.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading && <p className="text-xs text-slate-500">{t('adSpend.loading')}</p>}
          {error && <p className="text-xs text-amber-600">{error}</p>}
          {data && !loading && !error && (
            <>
              {data.data?.length === 0 ? (
                <p className="text-xs text-slate-500">{t('adSpend.noData')}</p>
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full min-w-[320px] text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 font-medium text-left">
                        <th className="py-2 pr-2">{t('adSpend.campaign')}</th>
                        <th className="py-2 pr-2 whitespace-nowrap">{t('adSpend.date')}</th>
                        <th className="py-2 pr-2 text-right">{t('adSpend.cost')}</th>
                        <th className="py-2 pr-2 text-right">{t('adSpend.clicks')}</th>
                        <th className="py-2 text-right">{t('adSpend.impressions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.data ?? []).map((row) => (
                        <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                          <td className="py-1.5 pr-2 text-slate-800 truncate max-w-[140px]" title={row.campaign_name}>
                            {row.campaign_name || row.campaign_id || '—'}
                          </td>
                          <td className="py-1.5 pr-2 whitespace-nowrap text-slate-600">{formatDate(row.spend_date)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700">{formatCost(row.cost_cents)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{row.clicks}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-600">{row.impressions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.data?.length ? (
                <p className="text-xs text-muted-foreground mt-1">{t('adSpend.campaignRows', { count: data.data.length })}</p>
              ) : null}
              {data.data?.length && (() => {
                const lastUpdated = data.data.reduce<string | null>(
                  (max, r) => (r.updated_at && (!max || r.updated_at > max) ? r.updated_at : max),
                  null
                );
                return lastUpdated ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('adSpend.lastUpdated')}: {formatTimestamp(lastUpdated, { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                ) : null;
              })()}
            </>
          )}
        </CardContent>
      </Card>
    </FeatureGuard>
  );
}
