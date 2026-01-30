'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { safeDecode } from '@/lib/utils/string-utils';
import { decodeMatchType } from '@/lib/types/hunter';
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
  utm_campaign_id?: string | null; // from URL when name missing
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_content?: string | null;
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
  onWhatsApp,
}: {
  intent: HunterIntent;
  onSeal: (params: { id: string; stars: number; score: number }) => void;
  /** When provided, SEAL DEAL opens Casino modal instead of star-based seal */
  onSealDeal?: () => void;
  onJunk: (params: { id: string; stars: number; score: number }) => void;
  onSkip: (params: { id: string }) => void;
  /** Optional: open WhatsApp chat (uses intent_target as number) */
  onWhatsApp?: () => void;
}) {
  const t = sourceTypeOf(intent.intent_action);
  const Icon = sourceIcon(t);
  const matchTypeDecoded = useMemo(() => decodeMatchType(intent.matchtype), [intent.matchtype]);
  const isHighPotential =
    matchTypeDecoded.type === 'exact' || (typeof intent.ai_score === 'number' && intent.ai_score > 80);
  const isHighIntent = t === 'whatsapp' || isHighPotential;

  const keywordDisplay = useMemo(() => {
    const term = (intent.utm_term || '').trim();
    if (term) return safeDecode(term);
    const primary = getPrimaryIntent(intent);
    return primary.value;
  }, [intent]);

  const campaignDisplay = useMemo(() => {
    const c = (intent.utm_campaign || '').trim();
    const id = (intent.utm_campaign_id || '').trim();
    if (c) {
      const decoded = safeDecode(c);
      if (/^\d{6,}$/.test(decoded)) return `Campaign ID: ${decoded.slice(0, 4)}…`;
      return decoded;
    }
    if (id) return `Campaign ID: ${id.length > 4 ? id.slice(0, 4) + '…' : id}`;
    return '—';
  }, [intent.utm_campaign, intent.utm_campaign_id]);

  const districtLabel = useMemo(() => safeDecode((intent.district || '').trim()) || null, [intent.district]);
  const cityLabel = useMemo(() => safeDecode((intent.city || '').trim()) || null, [intent.city]);
  const locationDisplay = useMemo(() => {
    if (districtLabel && cityLabel) return `${districtLabel} / ${cityLabel}`;
    if (districtLabel) return districtLabel;
    if (cityLabel) return cityLabel;
    return 'Unknown Location';
  }, [districtLabel, cityLabel]);
  const hasLocation = Boolean(districtLabel || cityLabel);

  const device = useMemo(() => deviceLabel(intent.device_type ?? null), [intent.device_type]);

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
                'inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border',
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
            {isHighPotential ? (
              <Badge className="bg-amber-100 text-amber-800 border border-amber-300 font-semibold">
                <Flame className="h-3.5 w-3.5 mr-1" />
                HIGH POTENTIAL
              </Badge>
            ) : null}
            <Badge variant="secondary" className="font-mono font-semibold">
              Score: {displayScore}
            </Badge>
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
                <span className="font-bold text-foreground break-words">{keywordDisplay || '—'}</span>
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
                    {matchTypeDecoded.highIntent ? 'Exact Match' : matchTypeDecoded.label}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
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
          <span className="font-semibold text-foreground">💰 EST. VALUE:</span>
          <span className="font-bold tabular-nums">
            {estDisplay || '—'}
          </span>
          {isHighSegment && estDisplay ? (
            <span className="text-muted-foreground text-sm">(High Segment)</span>
          ) : null}
        </div>
      </CardContent>

      {/* Footer: JUNK | WHATSAPP | SEAL DEAL ($) */}
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
            className="h-12 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
            onClick={() => {
              if (onWhatsApp) onWhatsApp();
              else if (intent.intent_target) {
                const raw = (intent.intent_target || '').replace(/\D/g, '');
                const num = raw.startsWith('90') ? raw : `90${raw}`;
                window.open(`https://wa.me/${num}`, '_blank');
              }
            }}
          >
            <MessageCircle className="h-4 w-4 mr-2" />
            WHATSAPP
          </Button>
          <Button
            variant="default"
            className="h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            onClick={() =>
              onSealDeal ? onSealDeal() : onSeal({ id: intent.id, stars: 0, score: displayScore })
            }
            data-testid="hunter-card-seal-deal"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            SEAL DEAL ($)
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

