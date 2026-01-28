'use client';

import { Badge } from '@/components/ui/badge';

interface ConfidenceScoreProps {
  score: number;
}

export function ConfidenceScore({ score }: ConfidenceScoreProps) {
  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-orange-400';
    if (score >= 40) return 'text-blue-400';
    return 'text-slate-400';
  };

  const getScoreBg = (score: number) => {
    if (score >= 70) return 'bg-orange-500/20 border-orange-500/30';
    if (score >= 40) return 'bg-blue-500/20 border-blue-500/30';
    return 'bg-slate-700/20 border-slate-600/30';
  };

  return (
    <Badge
      variant="outline"
      className={`tabular-nums font-semibold ${getScoreColor(score)} ${getScoreBg(score)}`}
    >
      {Math.round(score)}
    </Badge>
  );
}
