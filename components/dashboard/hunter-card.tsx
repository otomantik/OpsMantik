'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn, safeDecode, formatLocation } from '@/lib/utils';
import type { HunterIntent } from '@/lib/types/hunter';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Icons } from '@/components/icons';
import { Monitor, Smartphone, MapPin, Clock, FileText, Compass, Share2, Leaf, type LucideIcon } from 'lucide-react';

export type HunterSourceType = 'whatsapp' | 'phone' | 'form' | 'other';

const ICON_MAP: Record<string, LucideIcon> = {
  whatsapp: Icons.whatsapp,
  phone: Icons.phone,
  form: Icons.form,
  other: Icons.sparkles,
};

function relativeTime(ts: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (!Number.isFinite(diffMs)) return '—';
  const diffSec = Math.max(0, Math.round(diffMs / 1000));
  if (diffSec < 60) return t('common.justNow');
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}${t('common.min')} ${t('common.ago')}`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}${t('common.hr')} ${t('common.ago')}`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}${t('common.day')} ${t('common.ago')}`;
}

function sourceTypeOf(action: string | null | undefined): HunterSourceType {
  const a = (action || '').toLowerCase();
  if (a === 'whatsapp') return 'whatsapp';
  if (a === 'phone') return 'phone';
  if (a === 'form') return 'form';
  return 'other';
}

function getScoreColor(score: number): { border: string; bg: string; text: string } {
  if (score >= 85) return { border: 'border-blue-500/40', bg: 'bg-blue-500/10', text: 'text-blue-600' };
  if (score >= 50) return { border: 'border-blue-400/30', bg: 'bg-blue-500/5', text: 'text-blue-600' };
  return { border: 'border-slate-300', bg: 'bg-slate-100', text: 'text-slate-600' };
}

function deviceLabel(
  deviceType: string | null | undefined,
  deviceOs: string | null | undefined,
  browser: string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): { icon: LucideIcon; label: string } {
  const d = (deviceType || '').toLowerCase().trim();
  const os = (deviceOs || '').trim();
  const b = (browser || '').trim();
  const osLower = os.toLowerCase();

  let typeLabel = t('dimension.device');
  let Icon = Smartphone;

  if (d.includes('desktop') || d.includes('web')) {
    typeLabel = t('device.desktop');
    Icon = Monitor;
  } else if (d.includes('tablet')) {
    typeLabel = t('device.tablet');
  } else {
    typeLabel = t('device.mobile');
  }

  let detailedOs = os;
  if (osLower.includes('ios') || osLower.includes('iphone')) detailedOs = t('device.iphone');
  else if (osLower.includes('android')) detailedOs = t('device.android');
  else if (osLower.includes('mac os')) detailedOs = t('device.macbook');
  else if (osLower.includes('windows')) detailedOs = t('device.windows');

  let label = detailedOs || typeLabel;
  if (b && b !== 'Unknown') {
    label = detailedOs ? `${detailedOs} · ${b}` : `${typeLabel} · ${b}`;
  } else if (detailedOs) {
    label = `${typeLabel} · ${detailedOs}`;
  }

  if (!d && !os && !b) return { icon: Smartphone, label: t('device.unknown') };
  return { icon: Icon, label };
}

/** Path / or empty → Homepage; else show path or last segment */
function getPageLabel(pageUrl: string | null | undefined, t: (k: string) => string): string {
  const raw = (pageUrl || '').trim();
  if (!raw) return t('hunter.homepage');
  try {
    const path = new URL(raw, 'https://x').pathname.replace(/\/$/, '') || '/';
    if (path === '/') return t('hunter.homepage');
    const segment = path.split('/').filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : path;
  } catch {
    return raw.length > 24 ? `${raw.slice(0, 24)}…` : raw;
  }
}

function normalizeTraffic(
  traffic_source: string | null | undefined,
  traffic_medium: string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): { kind: 'google_ads' | 'seo' | 'social' | 'direct' | 'other'; label: string } {
  const src = (traffic_source || '').toString().trim();
  const med = (traffic_medium || '').toString().trim().toLowerCase();
  const srcLc = src.toLowerCase();

  // SEO: prefer medium=organic as the "certain" signal.
  if (med === 'organic') return { kind: 'seo', label: t('dimension.seo') };

  // Google Ads: common classifier outputs.
  if (srcLc.includes('google ads') || (srcLc.includes('google') && (med === 'cpc' || med === 'ppc' || med === 'paid'))) {
    return { kind: 'google_ads', label: t('dimension.googleAds') };
  }

  // Social: paid or organic social buckets.
  if (med === 'social' || med === 'paid_social' || ['instagram', 'facebook', 'meta', 'tiktok', 'linkedin', 'twitter', 'x'].some((k) => srcLc.includes(k))) {
    return { kind: 'social', label: t('dimension.social') };
  }

  // Direct
  if (med === 'direct' || srcLc === 'direct') return { kind: 'direct', label: t('dimension.direct') };

  if (!src && !med) return { kind: 'other', label: '—' };
  return { kind: 'other', label: src || t('dimension.other') };
}

function SourceBadge({ traffic_source, traffic_medium, t_fn }: { traffic_source?: string | null; traffic_medium?: string | null; t_fn: (key: string, params?: Record<string, string | number>) => string }) {
  const trk = normalizeTraffic(traffic_source, traffic_medium, t_fn);
  if (trk.kind === 'other' && (trk.label === '—' || !trk.label)) return null;

  const theme =
    trk.kind === 'google_ads'
      ? { cls: 'border-rose-200 bg-rose-50 text-rose-700', icon: Icons.google }
      : trk.kind === 'seo'
        ? { cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: Leaf }
        : trk.kind === 'social'
          ? { cls: 'border-blue-200 bg-blue-50 text-blue-700', icon: Share2 }
          : trk.kind === 'direct'
            ? { cls: 'border-slate-200 bg-slate-50 text-slate-700', icon: Compass }
            : { cls: 'border-slate-200 bg-slate-50 text-slate-700', icon: Icons.circleDot };

  const Icon = theme.icon as React.ComponentType<{ className?: string }>;

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', theme.cls)}>
      <Icon className="h-3.5 w-3.5" />
      <span className="leading-none">{trk.label}</span>
    </span>
  );
}

export function HunterCard({
  intent,
  traffic_source,
  traffic_medium,
  onSeal,
  onSealDeal,
  onJunk,
  onSkip,
  readOnly,
}: {
  intent: HunterIntent;
  traffic_source?: string | null;
  traffic_medium?: string | null;
  onSeal: (params: { id: string; stars: number; score: number }) => void;
  onSealDeal?: () => void;
  onJunk: (params: { id: string; stars: number; score: number }) => void;
  onSkip: (params: { id: string }) => void;
  readOnly?: boolean;
}) {
  const { t: translate } = useTranslation();
  const sourceType = sourceTypeOf(intent.intent_action);
  const IntentIcon = ICON_MAP[sourceType] || ICON_MAP.other;
  const trafficSource = traffic_source ?? intent.traffic_source ?? null;
  const trafficMedium = traffic_medium ?? intent.traffic_medium ?? null;
  const displayScore = useMemo(() => {
    const raw = intent.ai_score;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
    const mt = (intent.matchtype || '').toString().toLowerCase().trim();
    if (mt === 'e') return 85;
    const src = (intent.utm_source || '').toString().toLowerCase().trim();
    if (src === 'google') return 50;
    return 20;
  }, [intent.ai_score, intent.matchtype, intent.utm_source]);

  const scoreTheme = getScoreColor(displayScore);

  const device = useMemo(
    () => deviceLabel(intent.device_type ?? null, intent.device_os ?? null, intent.browser ?? null, translate),
    [intent.device_type, intent.device_os, intent.browser, translate]
  );

  const locationDisplay = useMemo(() => {
    const out = formatLocation(intent.city ?? null, intent.district ?? null);
    return out === '—' ? translate('hunter.locationUnknown') : out;
  }, [intent.city, intent.district, translate]);

  const pageDisplay = useMemo(
    () => getPageLabel(intent.intent_page_url || intent.page_url, translate),
    [intent.intent_page_url, intent.page_url, translate]
  );

  const keywordDisplay = useMemo(() => safeDecode((intent.utm_term || '').trim()) || '—', [intent.utm_term]);

  const actionsDisplay = useMemo(() => {
    const phoneClicks = typeof intent.phone_clicks === 'number' ? intent.phone_clicks : 0;
    const waClicks = typeof intent.whatsapp_clicks === 'number' ? intent.whatsapp_clicks : 0;
    const parts = [
      phoneClicks > 0 ? `${phoneClicks}× ${translate('session.phone')}` : null,
      waClicks > 0 ? `${waClicks}× WhatsApp` : null,
    ].filter(Boolean) as string[];
    return parts.length ? parts.join(' · ') : '—';
  }, [intent.phone_clicks, intent.whatsapp_clicks, translate]);

  return (
    <Card
      className={cn(
        'relative overflow-hidden bg-white border-2 flex flex-col shadow-sm min-h-0',
        scoreTheme.border
      )}
    >
      <CardHeader className="p-4 pb-2 shrink-0 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              'p-2.5 rounded-xl border shrink-0',
              'bg-blue-500/10 border-blue-500/20 text-blue-600'
            )}>
              <IntentIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">
                {sourceType === 'whatsapp' ? translate('hunter.intentWhatsApp') : sourceType === 'phone' ? translate('hunter.intentPhone') : sourceType === 'form' ? translate('hunter.intentForm') : translate('hunter.intentGeneral')}
              </div>
              <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                <Clock className="h-3.5 w-3.5" />
                <span suppressHydrationWarning>{relativeTime(intent.created_at, translate)}</span>
              </div>
            </div>
          </div>
          <div className={cn('shrink-0 flex flex-col items-end gap-1', scoreTheme.text)}>
            <SourceBadge traffic_source={trafficSource} traffic_medium={trafficMedium} t_fn={translate} />
            <span className="text-[10px] font-semibold uppercase tracking-wide">{translate('hunter.aiConfidence')}</span>
            <span className={cn('text-sm font-bold tabular-nums px-2 py-0.5 rounded-md border', scoreTheme.bg, scoreTheme.border)}>
              {displayScore}%
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 flex-1">
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
          <Row label={translate('hunter.sessionActions')} value={actionsDisplay} icon={Clock} />
          <Row label={translate('hunter.keyword')} value={keywordDisplay} icon={FileText} />
          <Row label={translate('hunter.location')} value={locationDisplay} icon={MapPin} />
          <Row label={translate('hunter.page')} value={pageDisplay} icon={FileText} />
          <Row label={translate('hunter.time')} value={relativeTime(intent.created_at, translate)} icon={Clock} />
          <Row label={translate('hunter.device')} value={device.label} icon={device.icon} />
        </div>
        {intent.ai_summary && (
          <div className="mt-3 p-3 rounded-lg border border-blue-200 bg-blue-50">
            <p className="text-xs leading-snug text-slate-700">{intent.ai_summary}</p>
          </div>
        )}
      </CardContent>

      <CardFooter className="p-4 pt-0 gap-2 shrink-0 border-t border-slate-100">
        <div className="grid grid-cols-3 gap-2 w-full">
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-slate-200 hover:bg-rose-50 hover:text-rose-700 font-semibold text-xs"
            onClick={() => onJunk({ id: intent.id, stars: 0, score: displayScore })}
            disabled={Boolean(readOnly)}
            title={readOnly ? translate('hunter.readOnlyRole') : translate('hunter.markJunk')}
          >
            {translate('hunter.junk')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-slate-200 font-semibold text-xs"
            onClick={() => onSkip({ id: intent.id })}
          >
            {translate('hunter.skip')}
          </Button>
          <Button
            size="sm"
            className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs"
            onClick={() => onSealDeal ? onSealDeal() : onSeal({ id: intent.id, stars: 0, score: displayScore })}
            disabled={Boolean(readOnly)}
            title={readOnly ? translate('hunter.readOnlyRole') : translate('hunter.sealLead')}
          >
            {translate('hunter.seal')}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function Row({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Icon className="h-4 w-4 text-blue-600 shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
        <div className="text-sm font-medium text-slate-800 truncate" title={value}>{value || '—'}</div>
      </div>
    </div>
  );
}
