'use client';

import { useEffect, useState } from 'react';
import { FeatureGuard } from '@/components/feature-guard';
import { UpsellUI } from '@/components/upsell-ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface SpendRow {
  id: string;
  campaign_name: string;
  cost_cents: number;
  spend_date: string;
}

interface AdSpendWidgetProps {
  siteId: string;
}

export function AdSpendWidget({ siteId }: AdSpendWidgetProps) {
  const { t } = useTranslation();
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
          setError(res.status === 403 ? 'Module not enabled' : res.statusText);
          setLoading(false);
          return;
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [siteId]);

  return (
    <FeatureGuard
      requiredModule="google_ads_spend"
      fallback={<UpsellUI title="Google Ads Spend is not enabled for this site." />}
    >
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Ad Spend</CardTitle>
          <CardDescription className="text-xs">Daily campaign spend (Google Ads)</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-xs text-slate-500">Loading…</p>}
          {error && <p className="text-xs text-amber-600">{error}</p>}
          {data && !loading && !error && (
            <div className="text-xs space-y-1">
              <p className="font-medium text-slate-700">{data.data?.length ?? 0} campaign rows</p>
              {data.data?.length ? (
                <p className="text-slate-500">
                  Latest: {data.data[0]?.campaign_name ?? '—'} ({(data.data[0]?.cost_cents ?? 0) / 100} units)
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </FeatureGuard>
  );
}
