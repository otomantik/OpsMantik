'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { safeDecode } from '@/lib/utils/string-utils';
import { decodeMatchType, type HunterIntent } from '@/lib/types/hunter';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  CheckCircle2,
  FileText,
  Flame,
  MessageCircle,
  Monitor,
  Smartphone,
  Phone,
  Search,
  ShoppingBag,
  Sparkles,
  MapPin,
  XOctagon,
} from 'lucide-react';

export type HunterSourceType = 'whatsapp' | 'phone' | 'form' | 'other';


type PrimaryIntent =
  | { kind: 'keyword'; label: 'KEYWORD'; icon: typeof Search; value: string }
  | { kind: 'interest'; label: 'INTEREST'; icon: typeof ShoppingBag | typeof Sparkles; value: string }
  | { kind: 'fallback'; label: 'CAMPAIGN'; icon: typeof Sparkles; value: string };

function relativeTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (!Number.isFinite(diffMs)) return '—';
  const diffSec = Math.max(0, Math.round(diffMs / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function sourceTypeOf(action: string | null | undefined): HunterSourceType {
  const a = (action || '').toLowerCase();
  if (a === 'whatsapp') return 'whatsapp';
  if (a === 'phone') return 'phone';
  if (a === 'form') return 'form';
  return 'other';
}

/** v3: Green = WhatsApp / High Score (>80) / Exact Match; Blue = Phone; Purple = Form */
function sourceStripClass(t: HunterSourceType, isHighIntent?: boolean): string {
  if (t === 'whatsapp' || isHighIntent) return 'border-l-4 border-emerald-500';
  if (t === 'phone') return 'border-l-4 border-blue-500';
  if (t === 'form') return 'border-l-4 border-purple-500';
  return 'border-l-4 border-border';
}

function sourceIcon(t: HunterSourceType) {
  if (t === 'whatsapp') return MessageCircle;
  if (t === 'phone') return Phone;
  if (t === 'form') return FileText;
  return Sparkles;
}



/** Display: `${device_type}` + (device_os ? ` · ${device_os}` : ''). E.g. "Mobile · iOS", "Desktop · Windows". */
function deviceLabel(
  deviceType: string | null | undefined,
  deviceOs?: string | null
): { icon: typeof Smartphone | typeof Monitor; label: string } {
  const d = (deviceType || '').toLowerCase().trim();
  const os = (deviceOs || '').trim();
  const typeLabel = !d
    ? 'Device'
    : d.includes('desktop') || d.includes('web')
      ? 'Desktop'
      : d.includes('tablet')
        ? 'Tablet'
        : 'Mobile';
  const label = os ? `${typeLabel} · ${os}` : typeLabel;
  if (!d && !os) return { icon: Smartphone, label: 'Device —' };
  if (d.includes('desktop') || d.includes('web')) return { icon: Monitor, label: label };
  return { icon: Smartphone, label: label };
}

/** Format estimated_value for CASINO CHIP: 5000 -> "5K", 20000 -> "20K" */
function formatEstimatedValue(value: number | null | undefined, currency?: string | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const sym = (currency || 'TRY').toUpperCase() === 'TRY' ? '₺' : (currency || '');
  if (value >= 1000) return `${Math.round(value / 1000)}K ${sym}`.trim();
  return `${value} ${sym}`.trim();
}

export function HunterCard({
  intent,
  onSeal,
  onSealDeal,
  onJunk,
  onSkip,
}: {
  intent: HunterIntent;
  onSeal: (params: { id: string; stars: number; score: number }) => void;
  /** When provided, SEAL DEAL opens Casino modal instead of star-based seal */
  onSealDeal?: () => void;
  onJunk: (params: { id: string; stars: number; score: number }) => void;
  onSkip: (params: { id: string }) => void;
}) {
  const t = sourceTypeOf(intent.intent_action);
  const Icon = sourceIcon(t);
  const matchTypeDecoded = useMemo(() => decodeMatchType(intent.matchtype), [intent.matchtype]);
  const isHighPotential =
    matchTypeDecoded.type === 'exact' || (typeof intent.ai_score === 'number' && intent.ai_score > 80);
  const isHighIntent = t === 'whatsapp' || isHighPotential;

  // 1) Keyword: ONLY sessions.utm_term; no path fallback; null/empty -> '—'
  const keywordDisplay = useMemo(() => {
    const term = (intent.utm_term || '').trim();
    return term ? safeDecode(term) : '—';
  }, [intent.utm_term]);

  // 2) Match: sessions.matchtype (e/p/b -> Exact Match/Phrase/Broad); null -> '—'
  const matchDisplay = useMemo(
    () => decodeMatchType(intent.matchtype).label,
    [intent.matchtype]
  );

  // 3) Campaign: ONLY sessions.utm_campaign; null -> '—'
  const campaignDisplay = useMemo(() => {
    const c = (intent.utm_campaign || '').trim();
    return c ? safeDecode(c) : '—';
  }, [intent.utm_campaign]);

  const districtLabel = useMemo(() => safeDecode((intent.district || '').trim()) || null, [intent.district]);
  const cityLabel = useMemo(() => safeDecode((intent.city || '').trim()) || null, [intent.city]);
  const locationDisplay = useMemo(() => {
    if (districtLabel && cityLabel) return `${districtLabel} / ${cityLabel}`;
    if (districtLabel) return districtLabel;
    if (cityLabel) return cityLabel;
    return 'Unknown Location';
  }, [districtLabel, cityLabel]);
  const hasLocation = Boolean(districtLabel || cityLabel);

  const device = useMemo(
    () => deviceLabel(intent.device_type ?? null, intent.device_os ?? null),
    [intent.device_type, intent.device_os]
  );

  const displayScore = useMemo(() => {
    const raw = intent.ai_score;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
    const mt = (intent.matchtype || '').toString().toLowerCase().trim();
    if (mt === 'e') return 85;
    const src = (intent.utm_source || '').toString().toLowerCase().trim();
    if (src === 'google') return 50;
    return 20;
  }, [intent.ai_score, intent.matchtype, intent.utm_source]);

  const estDisplay = useMemo(
    () => formatEstimatedValue(intent.estimated_value, intent.currency),
    [intent.estimated_value, intent.currency]
  );
  const isHighSegment =
    typeof intent.estimated_value === 'number' && Number.isFinite(intent.estimated_value) && intent.estimated_value > 10000;

  return (
    <Card
      className={cn(
        'relative overflow-hidden bg-card shadow-md border-border/80',
        sourceStripClass(t, isHighIntent)
      )}
    >
      {/* Header: [ICON] [TIME_AGO]    🔥 HIGH POTENTIAL    [ Score: {score} ] */}
      <CardHeader className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={cn(
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
                t === 'whatsapp' || isHighIntent
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : t === 'phone'
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : t === 'form'
                      ? 'border-purple-200 bg-purple-50 text-purple-700'
                      : 'border-border bg-muted text-muted-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium leading-none truncate">
                {relativeTime(intent.created_at)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground truncate">
                {t === 'whatsapp' ? 'WhatsApp' : t === 'phone' ? 'Phone' : t === 'form' ? 'Form' : 'Intent'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {isHighPotential ? (
              <Badge className="bg-amber-100 text-amber-800 border border-amber-300 font-semibold">
                <Flame className="h-3.5 w-3.5 mr-1" />
                HIGH POTENTIAL
              </Badge>
            ) : null}
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="secondary" className="font-mono font-semibold cursor-help">
                  Score: {displayScore}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>AI score (if pipeline enabled).</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 space-y-4">
        {/* Main grid: INTEL (left) + TARGET (right) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* INTEL */}
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-1.5">
              <span aria-hidden>🕵️</span> INTEL
            </div>
            <div className="space-y-2.5 text-sm">
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-20">Keyword:</span>
                <span className="font-bold text-foreground wrap-break-word">{keywordDisplay}</span>
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-muted-foreground shrink-0 w-20">Match:</span>
                {matchTypeDecoded.type !== 'unknown' ? (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-xs font-medium',
                      matchTypeDecoded.highIntent
                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {matchTypeDecoded.highIntent ? <Flame className="h-3 w-3 mr-0.5" /> : null}
                    {matchDisplay}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">{matchDisplay}</span>
                )}
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-20">Campaign:</span>
                <span className="text-foreground truncate">{campaignDisplay}</span>
              </div>
              {(intent.utm_source || intent.utm_medium) ? (
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0 w-20">Source / Medium:</span>
                  <span className="text-foreground truncate">
                    {[intent.utm_source, intent.utm_medium].filter(Boolean).join(' / ') || '—'}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {/* TARGET */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-1.5">
              <span aria-hidden>👤</span> TARGET
            </div>
            <div className="space-y-2.5 text-sm">
              {hasLocation ? (
                <div className="flex gap-2 items-center">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground shrink-0 w-16">Location:</span>
                  <span className="text-foreground truncate">{locationDisplay}</span>
                </div>
              ) : null}
              <div className="flex gap-2 items-center">
                <device.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground shrink-0 w-16">Device:</span>
                <span className="text-foreground">{device.label}</span>
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-muted-foreground shrink-0 w-16 ml-6">Network:</span>
                <span className="text-foreground">{intent.ads_network || 'Google Ads'}</span>
              </div>
              {intent.ads_placement ? (
                <div className="flex gap-2 items-center">
                  <span className="text-muted-foreground shrink-0 w-16 ml-6">Placement:</span>
                  <span className="text-foreground truncate">{intent.ads_placement}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Financial bar: EST. VALUE */}
        <div className="rounded-lg border border-border bg-emerald-50/50 dark:bg-emerald-950/20 px-4 py-3 flex items-center gap-2 flex-wrap">
          <Tooltip>
            <TooltipTrigger>
              <span className="font-semibold text-foreground cursor-help">💰 EST. VALUE:</span>
            </TooltipTrigger>
            <TooltipContent>Set when you seal a deal (manual/ops). Not AI.</TooltipContent>
          </Tooltip>
          <span className="font-bold tabular-nums">
            {estDisplay || '—'}
          </span>
          {isHighSegment && estDisplay ? (
            <span className="text-muted-foreground text-sm">(High Segment)</span>
          ) : null}
        </div>
      </CardContent>

      {/* Footer: JUNK | SKIP | SEAL DEAL */}
      <CardFooter className="px-4 pb-4 pt-0">
        <div className="grid w-full grid-cols-3 gap-2">
          <Button
            variant="outline"
            className="h-12 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            onClick={() => onJunk({ id: intent.id, stars: 0, score: displayScore })}
          >
            <XOctagon className="h-4 w-4 mr-2" />
            JUNK
          </Button>
          <Button
            variant="outline"
            className="h-12 border-muted-foreground/30 hover:bg-muted/50"
            onClick={() => onSkip({ id: intent.id })}
          >
            Skip
          </Button>
          <Button
            variant="default"
            className="h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold min-w-0"
            onClick={() =>
              onSealDeal ? onSealDeal() : onSeal({ id: intent.id, stars: 0, score: displayScore })
            }
            data-testid="hunter-card-seal-deal"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 mr-1.5" />
            <span className="truncate">SEAL DEAL</span>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

