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

interface BreakdownWidgetProps {
  siteId: string;
  dateRange: DateRange;
}

export function BreakdownWidget({ siteId, dateRange }: BreakdownWidgetProps) {
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
      case 'source': return 'Kaynak';
      case 'device': return 'Cihaz';
      case 'city': return 'Şehir';
    }
  };

  const getDimensionColor = (dim: BreakdownDimension) => {
    switch (dim) {
      case 'source': return 'text-blue-400';
      case 'device': return 'text-emerald-400';
      case 'city': return 'text-purple-400';
    }
  };

  return (
    <Card className="glass border-slate-800/50">
      <CardHeader className="pb-3 border-b border-slate-800/20">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-slate-200 uppercase tracking-tighter">
            Dağılım
          </CardTitle>
          
          {/* Dimension Selector */}
          <div className="flex gap-1">
            {(['source', 'device', 'city'] as BreakdownDimension[]).map((dim) => {
              const Icon = getDimensionIcon(dim);
              return (
                <button
                  key={dim}
                  onClick={() => setDimension(dim)}
                  className={`p-1.5 rounded border transition-colors ${
                    dimension === dim
                      ? 'bg-slate-700 border-slate-600 text-slate-200'
                      : 'bg-slate-800/30 border-slate-700/50 text-slate-500 hover:bg-slate-700/50'
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
            <AlertCircle className="w-8 h-8 text-rose-400 mb-2" />
            <p className="text-rose-200 font-mono text-xs mb-2">Hata: {error}</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 text-slate-600 animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-500 font-mono text-xs uppercase tracking-wider">
              Veri yok
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
                  className="flex items-center justify-between p-2 rounded bg-slate-800/20 border border-slate-700/30"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={`flex-shrink-0 ${getDimensionColor(dimension)}`}>
                      {(() => {
                        const Icon = getDimensionIcon(dimension);
                        return <Icon className="h-3.5 w-3.5" />;
                      })()}
                    </div>
                    <span className="text-[11px] font-mono text-slate-300 truncate">
                      {safeItem.dimension_value}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] font-mono text-slate-400">
                      {safeItem.count.toLocaleString()}
                    </span>
                    <span className="text-[9px] font-mono text-slate-600">
                      ({safeItem.percentage.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              );
            })}
            {data.length > 10 && (
              <p className="text-[9px] font-mono text-slate-600 text-center mt-2">
                +{data.length - 10} daha
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
