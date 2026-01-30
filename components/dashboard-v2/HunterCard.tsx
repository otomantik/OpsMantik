'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { safeDecode } from '@/lib/utils/string-utils';
import { decodeMatchType } from '@/lib/types/hunter';
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Flame,
  MessageCircle,
  Monitor,
  Smartphone,
  Phone,
  Search,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Star,
  Timer,
  MapPin,
  XOctagon,
} from 'lucide-react';

export type HunterSourceType = 'whatsapp' | 'phone' | 'form' | 'other';

/** HunterCard v3 intent shape (aligned with get_recent_intents_v2 + HunterCardIntentV3) */
export type HunterIntent = {
  id: string;
  intent_action?: string | null;
  intent_target?: string | null;
  created_at: string;

  // INTEL BOX (get_recent_intents_v2)
  page_url?: string | null;
  intent_page_url?: string | null;
  utm_term?: string | null;
  utm_campaign?: string | null;
  utm_source?: string | null;
  matchtype?: string | null; // e=Exact, p=Phrase, b=Broad

  // TARGET HUD
  city?: string | null;
  district?: string | null;
  device_type?: string | null;
  total_duration_sec?: number | null;
  click_id?: string | null;
  matched_session_id?: string | null;

  // CASINO CHIP
  estimated_value?: number | null;
  currency?: string | null;

  // Risk & AI
  risk_level?: 'low' | 'high' | string | null;
  ai_score?: number | null;
  ai_summary?: string | null;
  ai_tags?: string[] | null;
};

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

function safePath(url: string | null | undefined): string {
  if (!url) return '/';
  try {
    return new URL(url).pathname || '/';
  } catch {
    // Could already be a path
    if (url.startsWith('/')) return url;
    return '/';
  }
}

function titleCaseSlug(slug: string): string {
  const decoded = safeDecode(slug);
  const clean = decoded
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  return clean
    .split(' ')
    .filter(Boolean)
    .map((w) =>
      w.length <= 2
        ? w.toLocaleUpperCase('tr-TR')
        : (w[0]?.toLocaleUpperCase('tr-TR') ?? '') + w.slice(1).toLocaleLowerCase('tr-TR')
    )
    .join(' ');
}

/**
 * CHAMELEON INTELLIGENCE
 * - Search: utm_term exists -> KEYWORD
 * - PMax: no utm_term -> derive from page path slug -> INTEREST
 * - Fallback: utm_campaign or "General Visit"
 * Slug: safeDecode, dashes to spaces, Turkish-aware capitalize (tr-TR).
 */
function getPrimaryIntent(intent: HunterIntent): PrimaryIntent {
  const termRaw = (intent.utm_term || '').trim();
  const term = termRaw ? safeDecode(termRaw) : '';
  if (term) {
    return { kind: 'keyword', label: 'KEYWORD', icon: Search, value: term };
  }

  const pageUrl = intent.page_url || intent.intent_page_url || null;
  const path = safePath(pageUrl);
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || '';
  const derived = titleCaseSlug(last);
  if (derived && derived.toLocaleLowerCase('tr-TR') !== 'home' && derived.length >= 3) {
    return { kind: 'interest', label: 'INTEREST', icon: ShoppingBag, value: derived };
  }

  const campaignRaw = (intent.utm_campaign || '').trim();
  const campaign = campaignRaw ? safeDecode(campaignRaw) : '';
  return { kind: 'fallback', label: 'CAMPAIGN', icon: Sparkles, value: campaign || 'General Visit' };
}

function maskIdentity(v: string): string {
  const s = (v || '').toString().trim();
  if (!s) return '—';
  const digits = s.replace(/[^\d+]/g, '');
  const out = digits || s;
  return out;
}

function secondsToHuman(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || Number.isNaN(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function deviceLabel(deviceType: string | null | undefined): { icon: typeof Smartphone | typeof Monitor; label: string } {
  const d = (deviceType || '').toLowerCase();
  if (!d) return { icon: Smartphone, label: 'Device —' };
  if (d.includes('desktop') || d.includes('web')) return { icon: Monitor, label: 'Desktop' };
  if (d.includes('mobile') || d.includes('ios') || d.includes('android')) return { icon: Smartphone, label: d.replace(/_/g, ' ') };
  return { icon: Smartphone, label: d.replace(/_/g, ' ') };
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
  const isHighRisk = (intent.risk_level || '').toString().toLowerCase() === 'high';
  const matchTypeDecoded = useMemo(() => decodeMatchType(intent.matchtype), [intent.matchtype]);
  const isHighIntent =
    t === 'whatsapp' ||
    (typeof intent.ai_score === 'number' && intent.ai_score > 80) ||
    matchTypeDecoded.highIntent;

  const primary = useMemo(() => getPrimaryIntent(intent), [intent]);
  const path = useMemo(() => {
    const pageUrl = intent.page_url || intent.intent_page_url || null;
    const raw = safePath(pageUrl);
    return safeDecode(raw) || raw;
  }, [intent.intent_page_url, intent.page_url]);
  const secondary = useMemo(() => {
    const campaign = safeDecode((intent.utm_campaign || '').trim());
    const source = safeDecode((intent.utm_source || '').trim());
    if (primary.kind !== 'fallback' && campaign) return campaign;
    return source || (primary.kind === 'fallback' ? '' : '');
  }, [intent.utm_campaign, intent.utm_source, primary.kind]);

  const districtLabel = useMemo(() => safeDecode((intent.district || '').trim()) || null, [intent.district]);
  const cityLabel = useMemo(() => safeDecode((intent.city || '').trim()) || null, [intent.city]);
  const locationParts = useMemo(() => {
    if (districtLabel && cityLabel) return { district: districtLabel, city: cityLabel };
    if (districtLabel) return { district: districtLabel, city: null };
    if (cityLabel) return { district: null, city: cityLabel };
    return { district: null, city: null };
  }, [districtLabel, cityLabel]);

  const device = useMemo(() => deviceLabel(intent.device_type ?? null), [intent.device_type]);
  const duration = useMemo(() => {
    if (typeof intent.total_duration_sec !== 'number') return null;
    if (intent.total_duration_sec <= 0) return null;
    return secondsToHuman(intent.total_duration_sec);
  }, [intent.total_duration_sec]);

  const estDisplay = useMemo(
    () => formatEstimatedValue(intent.estimated_value, intent.currency),
    [intent.estimated_value, intent.currency]
  );

  const [stars, setStars] = useState<number>(0);
  const score = useMemo(() => stars * 20, [stars]);

  const hasKeyword = Boolean((intent.utm_term || '').trim());

  return (
    <Card
      className={cn(
        'relative overflow-hidden bg-card shadow-md min-h-[420px] border-border/80',
        sourceStripClass(t, isHighIntent)
      )}
    >
      {/* TOP BAR: Source Icon + Time + Intent Score Badge + Financial Badge */}
      <CardHeader className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-md border',
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
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            {typeof intent.ai_score === 'number' && intent.ai_score > 80 ? (
              <Badge className="bg-amber-100 text-amber-800 border border-amber-300 font-semibold">
                <Flame className="h-3.5 w-3.5 mr-1" />
                HOT LEAD
              </Badge>
            ) : null}
            {estDisplay ? (
              <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold">
                💰 Est. {estDisplay}
              </Badge>
            ) : null}
            {isHighRisk ? (
              <Badge className="bg-red-100 text-red-700 border border-red-200">
                <ShieldAlert className="h-3.5 w-3.5 mr-1" />
                High Risk
              </Badge>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">
                Safe
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 space-y-4">
        {/* MAIN GRID: INTEL BOX (left) + TARGET HUD (right) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* INTEL BOX — The "Why" */}
          <div
            className={cn(
              'rounded-lg border p-4',
              hasKeyword
                ? 'border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-700/50'
                : 'border-border bg-muted/50'
            )}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              INTEL
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <primary.icon
                  className={cn(
                    'h-4 w-4',
                    primary.kind === 'keyword'
                      ? 'text-amber-700'
                      : primary.kind === 'interest'
                        ? 'text-blue-700'
                        : 'text-muted-foreground'
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    {primary.label}
                  </span>
                  {matchTypeDecoded.type !== 'unknown' ? (
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-[10px] font-medium',
                        matchTypeDecoded.highIntent
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {matchTypeDecoded.highIntent ? <Flame className="h-3 w-3 mr-0.5" /> : null}
                      {matchTypeDecoded.highIntent ? 'Exact Match (High Intent)' : matchTypeDecoded.label}
                    </Badge>
                  ) : null}
                </div>
                <div
                  className={cn(
                    'mt-0.5 text-lg font-black leading-snug break-words',
                    primary.kind === 'keyword'
                      ? 'text-amber-800 dark:text-amber-200'
                      : primary.kind === 'interest'
                        ? 'text-blue-800 dark:text-blue-200'
                        : 'text-foreground',
                    hasKeyword && 'ring-1 ring-amber-300/40 rounded px-1 -mx-1'
                  )}
                >
                  {primary.value}
                </div>
                {secondary ? (
                  <div className="mt-1 text-xs text-muted-foreground truncate">
                    {secondary}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              <span className="font-medium text-muted-foreground">Path</span>{' '}
              <span className="font-mono truncate block">{path}</span>
            </div>
          </div>

          {/* TARGET HUD — The "Who" */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              TARGET
            </div>
            {locationParts.district || locationParts.city ? (
              <div className="flex items-center gap-1.5 text-sm mb-2">
                <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span>
                  {locationParts.district && locationParts.city ? (
                    <>
                      <span className="font-bold text-foreground">{locationParts.district}</span>
                      <span className="text-muted-foreground">, {locationParts.city}</span>
                    </>
                  ) : locationParts.district ? (
                    <span className="font-bold text-foreground">{locationParts.district}</span>
                  ) : (
                    <span className="text-foreground">{locationParts.city}</span>
                  )}
                </span>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
              <device.icon className="h-4 w-4 flex-shrink-0" />
              <span>{device.label}</span>
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Identity
              </div>
              <div className="mt-0.5 text-xl font-bold tabular-nums select-all truncate">
                {safeDecode(maskIdentity(intent.intent_target || ''))}
              </div>
            </div>
          </div>
        </div>

        {intent.ai_summary ? (
          <div data-testid="hunter-card-ai-summary" className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              AI Özet
            </div>
            <p className="mt-1 text-sm text-foreground leading-snug">{intent.ai_summary}</p>
            {Array.isArray(intent.ai_tags) && intent.ai_tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {intent.ai_tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* RATING */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Rating</div>
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, idx) => {
              const v = idx + 1;
              const active = v <= stars;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setStars(v)}
                  className={cn(
                    'h-10 w-10 rounded-md border border-border bg-background',
                    'inline-flex items-center justify-center',
                    'active:scale-[0.98] transition-transform'
                  )}
                  aria-label={`Rate ${v} stars`}
                  aria-pressed={active}
                >
                  <Star className={cn('h-5 w-5', active ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>

      {/* TRIGGER ZONE */}
      <CardFooter className="px-4 pb-4 pt-0">
        <div className="grid w-full grid-cols-3 gap-2">
          <Button
            variant="outline"
            className="h-14 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            onClick={() => onJunk({ id: intent.id, stars, score })}
          >
            <XOctagon className="h-5 w-5 mr-2" />
            JUNK
          </Button>
          <Button
            variant="ghost"
            className="h-14"
            onClick={() => onSkip({ id: intent.id })}
          >
            <ArrowRight className="h-5 w-5 mr-2" />
            SKIP
          </Button>
          <Button
            variant="default"
            className="h-14 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            onClick={() => (onSealDeal ? onSealDeal() : onSeal({ id: intent.id, stars, score }))}
            data-testid="hunter-card-seal-deal"
          >
            <CheckCircle2 className="h-5 w-5 mr-2" />
            SEAL DEAL
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

