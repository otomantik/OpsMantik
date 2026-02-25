'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';

export interface UpsellUIProps {
  title?: string;
  description?: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
}

/**
 * Placeholder upsell when a feature module is not enabled for the current site.
 * Callers MUST pass translated title, description, ctaLabel (e.g. via t('adSpend.upsellTitle') etc.)
 * so the correct locale is shown. No hardcoded English.
 */
export function UpsellUI({
  title = '',
  description = '',
  ctaLabel = '',
  onCtaClick,
}: UpsellUIProps) {
  return (
    <Card className="border-dashed border-slate-200 bg-slate-50/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-slate-400" />
          <CardTitle className="text-sm font-semibold text-slate-700">{title}</CardTitle>
        </div>
        <CardDescription className="text-xs text-slate-500">{description}</CardDescription>
      </CardHeader>
      {onCtaClick && (
        <CardContent className="pt-0">
          <Button variant="outline" size="sm" onClick={onCtaClick} className="text-xs">
            {ctaLabel}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
