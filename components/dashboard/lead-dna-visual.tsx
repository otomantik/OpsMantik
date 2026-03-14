'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Shield, Activity, Zap } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface LeadDnaVisualProps {
  dna: string;
  score: number;
  insights: { label: string; icon: string; value: string }[];
}

export function LeadDnaVisual({ dna, score, insights }: LeadDnaVisualProps) {
  const { t } = useTranslation();

  const dnaBlocks = useMemo(() => {
    return (dna || '').slice(0, 16).split('').map((char, i) => {
      const hue = (char.charCodeAt(0) * 137.5) % 360;
      return { id: i, color: `hsl(${hue}, 70%, 50%)` };
    });
  }, [dna]);

  const tracePath = useMemo(() => {
    if (!dna) return '';
    const points = dna.split('').map((c, i) => {
      const val = (c.charCodeAt(0) % 20);
      return `${i * 10},${25 - val}`;
    }).slice(0, 20);
    return `M ${points.join(' L ')}`;
  }, [dna]);

  const riskLabel = useMemo(() => {
    if (score > 80) return t('singularity.risk.low');
    if (score > 40) return t('singularity.risk.standard');
    return t('singularity.risk.high');
  }, [score, t]);

  const riskColor = useMemo(() => {
    if (score > 80) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (score > 40) return 'text-blue-600 bg-blue-50 border-blue-200';
    return 'text-amber-600 bg-amber-50 border-amber-200';
  }, [score]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/40 bg-white/40 backdrop-blur-xl p-5 shadow-inner transition-all duration-500 hover:shadow-lg">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
            <Shield className="h-4 w-4" />
          </div>
          <h4 className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">
            {t('singularity.title')}
          </h4>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-slate-400 opacity-60">
            {(dna || '').substring(0, 12).toUpperCase()}
          </span>
          <div className="flex gap-0.5">
            {dnaBlocks.map((block) => (
              <div
                key={block.id}
                className="w-2.5 h-2.5 rounded-[2px] transition-transform hover:scale-125 cursor-help"
                style={{ backgroundColor: block.color }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-xl bg-white/60 border border-white/80 shadow-sm transition-all hover:bg-white/80">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            {t('singularity.score')}
          </p>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-black text-slate-800 tracking-tighter">
              {score}%
            </span>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-1" />
          </div>
        </div>

        <div className={cn("p-4 rounded-xl border shadow-sm transition-all", riskColor)}>
          <p className="text-[9px] font-bold opacity-60 uppercase tracking-wider mb-2">
            {t('singularity.risk')}
          </p>
          <span className="text-xl font-extrabold uppercase tracking-tight">
            {riskLabel}
          </span>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
            {t('singularity.neuralTrace')}
          </span>
          <Activity className="h-3 w-3 text-slate-300 animate-pulse" />
        </div>
        <div className="h-10 w-full overflow-hidden rounded-lg bg-slate-900/5 border border-slate-900/5 relative">
          <svg className="absolute inset-0 w-full h-full" overflow="visible">
            <path
              d={tracePath}
              fill="none"
              stroke="url(#gradient-trace)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]"
            />
            <defs>
              <linearGradient id="gradient-trace" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
                <stop offset="50%" stopColor="#10b981" stopOpacity="1" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.2" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

      <div>
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">
          {t('singularity.insights')}
        </p>
        <div className="flex flex-wrap gap-2">
          {insights.map((insight, idx) => {
            // Map engine labels to i18n slugs
            const slugMap: Record<string, string> = {
              'Premium Geo': 'premiumGeo',
              'iOS Power User': 'neuralScored', // Mapping for brand consistency
              'Express Keyword': 'adsMatch',
              'Blitz Intent': 'highUrgency',
              'Loyal Visitor': 'returning',
              'Deep Engagement': 'neuralScored'
            };
            const slug = slugMap[insight.label] || insight.label;
            
            return (
              <div
                key={idx}
                className="group flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 bg-white shadow-sm transition-all hover:border-emerald-200 hover:bg-emerald-50/50 cursor-pointer"
              >
                <div className="p-1 rounded-full bg-slate-100 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition-colors">
                  <Zap className="h-2.5 w-2.5" />
                </div>
                <div className="flex flex-col -space-y-0.5">
                  <span className="text-[11px] font-semibold text-slate-600 group-hover:text-slate-900 transition-colors">
                    {String(t(`singularity.insight.${slug}` as any) || insight.label)}
                  </span>
                  {insight.value && insight.value !== 'Match' && insight.value !== 'Converted' && (
                    <span className="text-[9px] font-mono text-slate-400">
                      {insight.value}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
