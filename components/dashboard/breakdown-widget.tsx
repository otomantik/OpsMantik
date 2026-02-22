/**
 * Breakdown Widget - Phase 4
 * 
 * Displays breakdown by source, device, or city using get_dashboard_breakdown RPC.
 */

'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBreakdownData, BreakdownDimension } from '@/lib/hooks/use-breakdown-data';
import { DateRange } from '@/lib/hooks/use-dashboard-date-range';
import { TrendingUp, Smartphone, MapPin, Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface BreakdownWidgetProps {
  siteId: string;
  dateRange: DateRange;
}

export function BreakdownWidget({ siteId, dateRange }: BreakdownWidgetProps) {
  const { t, formatNumber } = useTranslation();
  const [dimension, setDimension] = useState<BreakdownDimension>('source');
  const { data, loading, error } = useBreakdownData(siteId, dateRange, dimension);

  const getDimensionIcon = (dim: BreakdownDimension) => {
    switch (dim) {
      case 'source': return TrendingUp;
      case 'device': return Smartphone;
      case 'city': return MapPin;
    }
  };

  const getDimensionLabel = (dim: BreakdownDimension) => {
    switch (dim) {
      case 'source': return t('common.dimension.source');
      case 'device': return t('common.dimension.device');
      case 'city': return t('common.dimension.city');
    }
  };

  const getDimensionColor = (dim: BreakdownDimension) => {
    switch (dim) {
      case 'source': return 'text-blue-600';
      case 'device': return 'text-emerald-600';
      case 'city': return 'text-muted-foreground';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold tracking-tight">
            {t('misc.breakdown')}
          </CardTitle>

          {/* Dimension Selector */}
          <div className="flex gap-1">
            {(['source', 'device', 'city'] as BreakdownDimension[]).map((dim) => {
              const Icon = getDimensionIcon(dim);
              return (
                <button
                  key={dim}
                  onClick={() => setDimension(dim)}
                  className={`p-1.5 rounded border transition-colors ${dimension === dim
                    ? 'bg-muted border-border text-foreground'
                    : 'bg-background border-border text-muted-foreground hover:bg-muted'
                    }`}
                  title={getDimensionLabel(dim)}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {error ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="w-8 h-8 text-destructive mb-2" />
            <p className="text-destructive text-sm mb-2">{t('misc.error')}: {error}</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground uppercase tracking-wider">
              {t('misc.noData')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* FIX 3: Defensive rendering - ensure data is array */}
            {Array.isArray(data) && data.slice(0, 10).map((item, index) => {
              // FIX 2: Ensure all values are properly typed
              const safeItem = {
                dimension_value: typeof item.dimension_value === 'string' ? item.dimension_value : 'Unknown',
                count: typeof item.count === 'number' ? item.count : 0,
                percentage: typeof item.percentage === 'number' ? item.percentage : 0,
              };
              return (
                <div
                  key={`${safeItem.dimension_value}-${index}`}
                  className="flex items-center justify-between p-2 rounded bg-muted/50 border border-border"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={`shrink-0 ${getDimensionColor(dimension)}`}>
                      {(() => {
                        const Icon = getDimensionIcon(dimension);
                        return <Icon className="h-3.5 w-3.5" />;
                      })()}
                    </div>
                    <span className="text-sm text-foreground truncate">
                      {safeItem.dimension_value}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
                      {formatNumber(safeItem.count)}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      ({safeItem.percentage.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              );
            })}
            {data.length > 10 && (
              <p className="text-sm text-muted-foreground text-center mt-2">
                +{data.length - 10} {t('common.more')}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
