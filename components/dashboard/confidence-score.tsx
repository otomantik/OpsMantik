'use client';

import { Badge } from '@/components/ui/badge';

interface ConfidenceScoreProps {
  score: number;
}

export function ConfidenceScore({ score }: ConfidenceScoreProps) {
  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-amber-800';
    if (score >= 40) return 'text-blue-700';
    return 'text-muted-foreground';
  };

  const getScoreBg = (score: number) => {
    if (score >= 70) return 'bg-amber-50 border-amber-200';
    if (score >= 40) return 'bg-blue-100 border-blue-200';
    return 'bg-muted border-border';
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
