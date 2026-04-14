'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn, safeDecode, formatDisplayLocation } from '@/lib/utils';
import type { HunterIntent } from '@/lib/types/hunter';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { TranslationKey } from '@/lib/i18n/t';
import { Icons } from '@/components/icons';
import { Monitor, Smartphone, MapPin, Clock, FileText, Compass, Share2, Leaf, Trash2, UserCheck, ShieldCheck, CircleDollarSign, Target, Activity, Info, X, type LucideIcon } from 'lucide-react';
import { computeLcv } from '@/lib/oci/lcv-engine';

export type HunterSourceType = 'whatsapp' | 'phone' | 'form' | 'other';

const ICON_MAP: Record<string, LucideIcon> = {
  whatsapp: Icons.whatsapp,
  phone: Icons.phone,
  form: Icons.form,
  other: Icons.sparkles,
};

function relativeTime(ts: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
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

/** Strip tel:, wa:, whatsapp:, form: and legacy wa URLs from intent_target. */
function normalizeIntentTarget(raw: string | null | undefined): string {
  const s = (raw || '').trim();
  if (!s) return '';
  return s
    .replace(/^tel:/i, '')
    .replace(/^wa:/i, '')
    .replace(/^whatsapp:/i, '')
    .replace(/^form:/i, '')
    .replace(/^https?:\/\/wa\.me\//i, '')
    .replace(/^\+/, '')
    .trim();
}

/** Adaptive anonymous fallback per intent_action. */
function getAnonymousLabel(
  action: string | null | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  const a = (action || '').toLowerCase();
  if (a === 'phone') return t('hunter.anonimCall');
  if (a === 'whatsapp') return t('hunter.anonimWhatsApp');
  return t('hunter.anonimContact');
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
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): { icon: LucideIcon; label: string } {
  const d = (deviceType || '').toLowerCase().trim();
  const os = (deviceOs || '').trim();
  const b = (browser || '').trim();
  const osLower = os.toLowerCase();

  let typeLabel = t('common.dimension.device');
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
function getPageLabel(pageUrl: string | null | undefined, t: (k: TranslationKey) => string): string {
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
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): { kind: 'google_ads' | 'seo' | 'social' | 'direct' | 'referral' | 'other'; label: string } {
  const src = (traffic_source || '').toString().trim();
  const med = (traffic_medium || '').toString().trim().toLowerCase();
  const srcLc = src.toLowerCase();

  // SEO: prefer medium=organic as the "certain" signal.
  if (med === 'organic') return { kind: 'seo', label: t('common.dimension.seo') };

  // Google Ads: common classifier outputs.
  if (srcLc.includes('google ads') || (srcLc.includes('google') && (med === 'cpc' || med === 'ppc' || med === 'paid'))) {
    return { kind: 'google_ads', label: t('common.dimension.googleAds') };
  }

  // Social: paid or organic social buckets.
  if (med === 'social' || med === 'paid_social' || ['instagram', 'facebook', 'meta', 'tiktok', 'linkedin', 'twitter', 'x'].some((k) => srcLc.includes(k))) {
    if (srcLc.includes('facebook')) return { kind: 'social', label: 'Facebook' };
    if (srcLc.includes('instagram')) return { kind: 'social', label: 'Instagram' };
    if (srcLc.includes('tiktok')) return { kind: 'social', label: 'TikTok' };
    if (srcLc.includes('linkedin')) return { kind: 'social', label: 'LinkedIn' };
    return { kind: 'social', label: t('common.dimension.social') };
  }

  // Direct
  if (med === 'direct' || srcLc === 'direct') return { kind: 'direct', label: t('common.dimension.direct') };
  if (med === 'referral' || srcLc === 'referral') return { kind: 'referral', label: t('common.dimension.referral') };

  if (!src && !med) return { kind: 'other', label: '—' };
  return { kind: 'other', label: src || t('common.dimension.other') };
}

function resolveTraffic(
  params: {
    trafficSource?: string | null;
    trafficMedium?: string | null;
    attributionSource?: string | null;
    utmSource?: string | null;
    hasAnyClickId?: boolean;
  },
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): { kind: 'google_ads' | 'seo' | 'social' | 'direct' | 'referral' | 'other'; label: string } {
  const base = normalizeTraffic(params.trafficSource, params.trafficMedium, t);
  if (base.kind !== 'other' || base.label !== '—') return base;

  const attribution = (params.attributionSource || '').trim().toLowerCase();
  const utmSource = (params.utmSource || '').trim().toLowerCase();

  if (
    params.hasAnyClickId ||
    attribution.includes('google') ||
    attribution.includes('ads assisted') ||
    attribution.includes('first click (paid)') ||
    attribution.includes('paid (utm)') ||
    utmSource === 'google'
  ) {
    return { kind: 'google_ads', label: t('common.dimension.googleAds') };
  }
  if (attribution.includes('organic') || attribution.includes('seo')) {
    return { kind: 'seo', label: t('common.dimension.seo') };
  }
  if (attribution.includes('social') || ['facebook', 'instagram', 'meta', 'tiktok', 'linkedin'].includes(utmSource)) {
    if (utmSource === 'facebook') return { kind: 'social', label: 'Facebook' };
    if (utmSource === 'instagram') return { kind: 'social', label: 'Instagram' };
    if (utmSource === 'tiktok') return { kind: 'social', label: 'TikTok' };
    if (utmSource === 'linkedin') return { kind: 'social', label: 'LinkedIn' };
    return { kind: 'social', label: t('common.dimension.social') };
  }
  if (attribution.includes('direct')) {
    return { kind: 'direct', label: t('common.dimension.direct') };
  }
  if (attribution.includes('referral')) {
    return { kind: 'referral', label: t('common.dimension.referral') };
  }
  return base;
}

function formatDurationCompact(
  sec: number | null | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string | null {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return null;
  if (sec < 60) return `${Math.round(sec)}${t('common.sec')}`;
  const minutes = Math.floor(sec / 60);
  const seconds = Math.round(sec % 60);
  if (minutes < 60) return `${minutes}${t('common.min')}${seconds > 0 ? ` ${seconds}${t('common.sec')}` : ''}`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}${t('common.hr')}${remMinutes > 0 ? ` ${remMinutes}${t('common.min')}` : ''}`;
}

function fallbackActionLabel(
  sourceType: HunterSourceType,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string | null {
  if (sourceType === 'phone') return t('hunter.intentPhone');
  if (sourceType === 'whatsapp') return t('hunter.intentWhatsApp');
  if (sourceType === 'form') return t('hunter.intentForm');
  return null;
}

function formatFormStateLabel(
  state: string | null | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  const v = (state || '').toLowerCase().trim();
  if (v === 'started') return t('hunter.formState.started');
  if (v === 'attempted') return t('hunter.formState.attempted');
  if (v === 'validation_failed') return t('hunter.formState.validationFailed');
  if (v === 'network_failed') return t('hunter.formState.networkFailed');
  if (v === 'success') return t('hunter.formState.success');
  return t('common.unknown');
}

function formatFormSummary(
  summary: Record<string, unknown> | null | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  if (!summary) return '—';
  const parts: string[] = [];
  const fields = typeof summary.field_count === 'number' ? summary.field_count : null;
  const required = typeof summary.required_field_count === 'number' ? summary.required_field_count : null;
  const invalid = typeof summary.invalid_field_count === 'number' ? summary.invalid_field_count : null;
  const files = typeof summary.file_input_count === 'number' ? summary.file_input_count : null;
  const transport = typeof summary.form_transport === 'string' ? summary.form_transport : null;
  if (typeof fields === 'number') parts.push(t('hunter.summary.fields', { count: fields }));
  if (typeof required === 'number' && required > 0) parts.push(t('hunter.summary.required', { count: required }));
  if (typeof invalid === 'number' && invalid > 0) parts.push(t('hunter.summary.invalid', { count: invalid }));
  if (typeof files === 'number' && files > 0) parts.push(t('hunter.summary.file', { count: files }));
  if (transport) parts.push(transport);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function SourceBadge({
  traffic_source,
  traffic_medium,
  attribution_source,
  utm_source,
  has_any_click_id,
  t_fn,
}: {
  traffic_source?: string | null;
  traffic_medium?: string | null;
  attribution_source?: string | null;
  utm_source?: string | null;
  has_any_click_id?: boolean;
  t_fn: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const trk = resolveTraffic(
    {
      trafficSource: traffic_source,
      trafficMedium: traffic_medium,
      attributionSource: attribution_source,
      utmSource: utm_source,
      hasAnyClickId: has_any_click_id,
    },
    t_fn
  );
  if (trk.kind === 'other' && (trk.label === '—' || !trk.label)) return null;

  const theme =
    trk.kind === 'google_ads'
      ? { cls: 'border-rose-200 bg-rose-50 text-rose-700', icon: Icons.google }
      : trk.kind === 'seo'
        ? { cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: Leaf }
        : trk.kind === 'social'
          ? { cls: 'border-blue-200 bg-blue-50 text-blue-700', icon: Share2 }
          : trk.kind === 'referral'
            ? { cls: 'border-amber-200 bg-amber-50 text-amber-700', icon: Compass }
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

export const HunterCard = React.memo(({
  intent,
  traffic_source,
  traffic_medium,
  onSeal,
  onSealDeal,
  onJunk,
  onSkip,
  onQualify,
  readOnly,
}: {
  intent: HunterIntent;
  traffic_source?: string | null;
  traffic_medium?: string | null;
  onSeal: (params: { id: string; score: number }) => void;
  onSealDeal?: () => void;
  onJunk: (params: { id: string; score: number }) => void;
  onSkip: (params: { id: string }) => void;
  onQualify?: (params: { score: 60 | 80; status: 'confirmed' }) => void;
  readOnly?: boolean;
}) => {
  const { t: translate } = useTranslation();
  
  // 1. QUANTUM INTELLIGENCE: Real-time adjusted singularity score
  const intel = useMemo(() => {
    return computeLcv({
      stage: 'V3', // Default reference stage for intel box
      baseAov: 1000, 
      city: intent.city,
      district: intent.district,
      deviceType: intent.device_type,
      deviceOs: intent.device_os,
      trafficSource: traffic_source || intent.traffic_source,
      trafficMedium: traffic_medium || intent.traffic_medium,
      utmTerm: intent.utm_term,
      matchtype: intent.matchtype,
      phoneClicks: intent.phone_clicks,
      whatsappClicks: intent.whatsapp_clicks,
      eventCount: intent.event_count,
      totalDurationSec: intent.total_duration_sec,
      isReturning: intent.is_returning
    });
  }, [intent, traffic_source, traffic_medium]);

  const displayScore = intel.singularityScore;
  const scoreTheme = getScoreColor(displayScore);

  const [showIntel, setShowIntel] = React.useState(false);

  const sourceType = sourceTypeOf(intent.intent_action);
  const IntentIcon = ICON_MAP[sourceType] || ICON_MAP.other;
  const trafficSource = traffic_source ?? intent.traffic_source ?? null;
  const trafficMedium = traffic_medium ?? intent.traffic_medium ?? null;

  const device = useMemo(
    () => deviceLabel(intent.device_type ?? null, intent.device_os ?? null, intent.browser ?? null, translate),
    [intent.device_type, intent.device_os, intent.browser, translate]
  );

  const identityDisplay = useMemo(() => {
    const norm = normalizeIntentTarget(intent.intent_target);
    if (norm) return norm;
    return getAnonymousLabel(intent.intent_action, translate);
  }, [intent.intent_target, intent.intent_action, translate]);

  const geoDisplay = useMemo(() => {
    const out = formatDisplayLocation(intent.city || null, intent.district || null, intent.location_source);
    if (!out) return translate('hunter.locationUnknown');
    return out.toLocaleUpperCase('tr-TR');
  }, [intent.city, intent.district, intent.location_source, translate]);

  const locationDisplay = useMemo(() => {
    const out = formatDisplayLocation(intent.city || null, intent.district || null, intent.location_source);
    return out ?? translate('hunter.locationUnknown');
  }, [intent.city, intent.district, intent.location_source, translate]);

  const leadSourceLabel = useMemo(() => {
    const trk = resolveTraffic(
      {
        trafficSource,
        trafficMedium,
        attributionSource: intent.attribution_source ?? null,
        utmSource: intent.utm_source ?? null,
        hasAnyClickId: Boolean(
          (intent.click_id && intent.click_id.trim()) ||
          (intent.gclid && intent.gclid.trim()) ||
          (intent.wbraid && intent.wbraid.trim()) ||
          (intent.gbraid && intent.gbraid.trim())
        ),
      },
      translate
    );
    return trk.label;
  }, [intent.attribution_source, intent.click_id, intent.gbraid, intent.gclid, intent.utm_source, intent.wbraid, trafficSource, trafficMedium, translate]);

  const liveEvDisplay = useMemo(() => {
    const ev = intent.estimated_value;
    const cur = (intent.currency || 'TRY').trim().toUpperCase();
    if (ev == null || !Number.isFinite(ev) || ev < 0) return '—';
    return `${ev.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${cur}`;
  }, [intent.estimated_value, intent.currency]);

  const locationWithSource = useMemo(() => {
    if (intent.location_source === 'gclid') {
      return (
        <span className="inline-flex items-center gap-2 flex-wrap">
          <span>{locationDisplay}</span>
          <span className="inline-flex items-center rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800" title={translate('hunter.locationSourceGclidTitle')}>
            {translate('hunter.locationSourceGclid')}
          </span>
        </span>
      );
    }
    return locationDisplay;
  }, [intent.location_source, locationDisplay, translate]);

  const pageDisplay = useMemo(
    () => getPageLabel(intent.intent_page_url || intent.page_url, translate),
    [intent.intent_page_url, intent.page_url, translate]
  );

  const keywordDisplay = useMemo(() => safeDecode((intent.utm_term || '').trim()) || '—', [intent.utm_term]);

  const formStateDisplay = useMemo(() => formatFormStateLabel(intent.form_state, translate), [intent.form_state, translate]);
  const formSummaryDisplay = useMemo(
    () => formatFormSummary(intent.form_summary ?? null, translate),
    [intent.form_summary, translate]
  );
  const hasAnyClickId = Boolean(
    (intent.click_id && intent.click_id.trim()) ||
    (intent.gclid && intent.gclid.trim()) ||
    (intent.wbraid && intent.wbraid.trim()) ||
    (intent.gbraid && intent.gbraid.trim())
  );
  const sourceInfo = useMemo(
    () =>
      resolveTraffic(
        {
          trafficSource,
          trafficMedium,
          attributionSource: intent.attribution_source ?? null,
          utmSource: intent.utm_source ?? null,
          hasAnyClickId,
        },
        translate
      ),
    [hasAnyClickId, intent.attribution_source, intent.utm_source, trafficMedium, trafficSource, translate]
  );
  const campaignDisplay = useMemo(() => {
    if (intent.utm_campaign && intent.utm_campaign.trim()) return intent.utm_campaign.trim();
    if (hasAnyClickId) return translate('common.dimension.googleAds');
    if (intent.attribution_source && intent.attribution_source.trim()) return intent.attribution_source.trim();
    return '—';
  }, [hasAnyClickId, intent.attribution_source, intent.utm_campaign, translate]);
  const clickIdDisplay = useMemo(() => {
    const raw =
      (intent.click_id && intent.click_id.trim()) ||
      (intent.gclid && intent.gclid.trim()) ||
      (intent.wbraid && intent.wbraid.trim()) ||
      (intent.gbraid && intent.gbraid.trim()) ||
      '';
    if (!raw) return '—';
    return raw.length > 32 ? `${raw.slice(0, 29)}...` : raw;
  }, [intent.click_id, intent.gclid, intent.wbraid, intent.gbraid]);
  const actionsDisplay = useMemo(() => {
    const phoneClicks = typeof intent.phone_clicks === 'number' ? intent.phone_clicks : 0;
    const waClicks = typeof intent.whatsapp_clicks === 'number' ? intent.whatsapp_clicks : 0;
    const parts = [
      phoneClicks > 0 ? `${phoneClicks}× ${translate('session.phone')}` : null,
      waClicks > 0 ? `${waClicks}× ${translate('event.whatsapp')}` : null,
      typeof intent.event_count === 'number' && intent.event_count > 0
        ? translate('session.eventCount', { count: intent.event_count })
        : null,
      formatDurationCompact(intent.total_duration_sec ?? null, translate),
    ].filter(Boolean) as string[];
    if (parts.length > 0) return parts.join(' · ');
    const sourceAction = fallbackActionLabel(sourceType, translate);
    if (sourceAction) return sourceAction;
    if (sourceInfo.kind === 'google_ads') return translate('common.dimension.googleAds');
    return '—';
  }, [intent.event_count, intent.phone_clicks, intent.total_duration_sec, intent.whatsapp_clicks, sourceInfo.kind, sourceType, translate]);

  return (
    <Card
      className={cn(
        'relative overflow-hidden bg-white border border-slate-200 flex flex-col shadow-[0_40px_80px_rgba(0,0,0,0.06)] min-h-0 rounded-[3rem] transition-all duration-500 animate-in fade-in slide-in-from-right-10',
        scoreTheme.border
      )}
    >
      {/* Real-time Intelligence HUD Overlay */}
      {showIntel && (
        <div className="absolute inset-0 z-50 bg-slate-900/95 backdrop-blur-md p-10 text-white animate-in fade-in duration-300 rounded-[3rem] flex flex-col">
           <div className="flex items-center justify-between mb-8">
              <h4 className="text-xl font-black uppercase tracking-widest">{translate('common.dimension.conversionProbability')}</h4>
              <button onClick={() => setShowIntel(false)} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors">
                <X className="h-4 w-4" />
              </button>
           </div>
           
           <div className="grid grid-cols-2 gap-4 flex-1">
              <div className="space-y-4">
                 <IntelRow label="Location" val={intel.breakdown.qLocation} />
                 <IntelRow label="Device" val={intel.breakdown.qDevice} />
                 <IntelRow label="Keyword" val={intel.breakdown.qSource} />
                 <IntelRow label="Behavior" val={intel.breakdown.qBehavior} />
              </div>
              <div className="flex flex-col items-center justify-center border-l border-white/10">
                 <div className="text-7xl font-black">{displayScore}</div>
                 <div className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] mt-2">Final Probability Score</div>
              </div>
           </div>

           <div className="mt-8 pt-8 border-t border-white/10">
              <p className="text-xs text-white/60 font-medium italic">"Intelligence values are calculated based on session duration, device OS, district premium status, and search intent match."</p>
           </div>
        </div>
      )}
      <CardHeader className="p-6 sm:p-10 pb-4 sm:pb-6 shrink-0 border-b border-slate-50 bg-slate-50/50">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-5 min-w-0 flex-1">
            <div className={cn(
              'w-16 h-16 rounded-[1.75rem] border shrink-0 shadow-xl flex items-center justify-center transition-all duration-500',
              'bg-white border-slate-100 text-blue-600 shadow-blue-500/5'
            )}>
              <IntentIcon className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 mb-1">
                <div className="text-2xl sm:text-3xl font-black text-slate-900 wrap-anywhere leading-none tracking-tight">
                  {identityDisplay}
                </div>
                {intent.is_returning && (
                  <span className="shrink-0 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest ring-1 ring-emerald-100">
                    {translate('activity.returning')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-3 text-blue-600/70">
                <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                <span className="text-xs font-black tracking-widest leading-none uppercase">{geoDisplay}</span>
              </div>
            </div>
          </div>
          <div className={cn('shrink-0 flex flex-col items-end gap-3')}>
            <SourceBadge
              traffic_source={trafficSource}
              traffic_medium={trafficMedium}
              attribution_source={intent.attribution_source ?? null}
              utm_source={intent.utm_source ?? null}
              has_any_click_id={hasAnyClickId}
              t_fn={translate}
            />
            <div 
              onClick={() => setShowIntel(true)}
              className={cn('group/pts cursor-pointer px-4 py-2 rounded-2xl border bg-white font-black text-xs tabular-nums shadow-lg transition-all hover:scale-105 active:scale-95 flex items-center gap-2', scoreTheme.text, scoreTheme.border)}
            >
              <Info className="h-3.5 w-3.5 opacity-0 group-hover/pts:opacity-100 transition-opacity" />
              {displayScore} PTS
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 flex-1 space-y-4">
        <div className="grid gap-3 rounded-3xl border border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-3">
          <div className="flex min-w-0 items-center gap-2">
            <Target className="h-4 w-4 text-slate-400" aria-hidden />
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-600 truncate" title={leadSourceLabel}>
              {sourceInfo.label || leadSourceLabel || '—'}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <CircleDollarSign className="h-4 w-4 text-emerald-500" aria-hidden />
            <span className="text-[11px] font-black uppercase tracking-widest text-emerald-700 truncate">
              {liveEvDisplay}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:justify-end">
            <Clock className="h-4 w-4 text-slate-400 shrink-0" aria-hidden />
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-600 truncate" suppressHydrationWarning>
              {relativeTime(intent.created_at, translate)}
            </span>
          </div>
        </div>
        
        <div className="rounded-[2.5rem] border border-slate-100 bg-white p-6 sm:p-8 space-y-4 shadow-inner shadow-slate-500/5">
          <Row label={translate('hunter.sessionActions')} value={actionsDisplay} icon={Clock} />
          {sourceType === 'form' && (
            <Row label={translate('hunter.formState')} value={formStateDisplay} icon={FileText} />
          )}
          {sourceType === 'form' && (
            <Row label={translate('hunter.formShape')} value={formSummaryDisplay} icon={FileText} />
          )}
          <Row label={translate('hunter.keyword')} value={keywordDisplay} icon={FileText} />
          <Row label={translate('hunter.leadSource')} value={sourceInfo.label || '—'} icon={Compass} />
          <Row label={translate('hunter.campaign')} value={campaignDisplay} icon={Target} />
          {hasAnyClickId && (
            <Row label={translate('common.technical.clickId')} value={clickIdDisplay} icon={Compass} />
          )}
          <Row label={translate('hunter.location')} value={locationWithSource} icon={MapPin} />
          <Row label={translate('hunter.page')} value={pageDisplay} icon={FileText} />
          <Row label={translate('hunter.device')} value={device.label} icon={device.icon} />
        </div>

        {intent.ai_summary && (
          <div className="rounded-3xl border border-blue-50 bg-blue-50/30 p-4">
             <div className="flex items-center gap-2 mb-2">
                <Activity className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">{translate('common.intent')}</span>
             </div>
            <p className="text-sm font-bold leading-relaxed text-slate-700">{intent.ai_summary}</p>
          </div>
        )}
      </CardContent>

      <CardFooter className="p-6 pt-0 gap-3 shrink-0 border-t border-slate-50 flex-col bg-slate-50/10">
        <div className="grid grid-cols-2 gap-3 w-full sm:grid-cols-4">
          <Button
            variant="outline"
            size="sm"
            className="h-14 border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-100 font-black text-xs transition-all duration-300 uppercase tracking-widest rounded-2xl hover:-translate-y-1 hover:shadow-lg"
            onClick={() => onJunk({ id: intent.id, score: displayScore })}
            disabled={Boolean(readOnly)}
            title={readOnly ? translate('hunter.readOnlyRole') : translate('hunter.markJunk')}
          >
            <Trash2 className="h-4 w-4 shrink-0 sm:mr-2" aria-hidden />
            <span className="hidden sm:inline">{translate('hunter.junk')}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-14 border-slate-200 font-black text-xs text-slate-400 hover:bg-slate-100 transition-all duration-300 uppercase tracking-widest rounded-2xl hover:-translate-y-1 hover:shadow-lg"
            onClick={() => onSkip({ id: intent.id })}
            title={translate('hunter.skip')}
          >
            <span className="">{translate('hunter.skip')}</span>
          </Button>

          {onQualify ? (
            <Button
              variant="outline"
              size="sm"
              className="h-14 border-slate-200 font-black text-xs transition-all duration-300 hover:bg-blue-600 hover:text-white hover:border-blue-600 uppercase tracking-widest rounded-2xl col-span-2 sm:col-span-1 hover:-translate-y-1 hover:shadow-lg hover:shadow-blue-500/10"
              onClick={() => onQualify({ score: 60, status: 'confirmed' })}
              disabled={Boolean(readOnly)}
              title={translate('hunter.gorusuldu')}
            >
              <UserCheck className="h-4 w-4 shrink-0 sm:mr-2" aria-hidden />
              <span>{translate('hunter.gorusuldu')}</span>
            </Button>
          ) : (
            <div className="hidden sm:block" />
          )}

          <Button
            size="sm"
            className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white font-black text-sm shadow-xl shadow-blue-500/20 transition-all duration-300 uppercase tracking-widest rounded-2xl col-span-2 sm:col-span-1 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/30"
            onClick={() => onSealDeal ? onSealDeal() : onSeal({ id: intent.id, score: displayScore })}
            disabled={Boolean(readOnly)}
            title={readOnly ? translate('hunter.readOnlyRole') : translate('hunter.sealLead')}
            data-testid="hunter-card-seal-deal"
          >
            <ShieldCheck className="h-5 w-5 shrink-0 mr-2" aria-hidden />
            <span>{translate('hunter.seal')}</span>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
});

HunterCard.displayName = 'HunterCard';

const IntelRow = ({ label, val }: { label: string; val: number }) => (
  <div className="flex flex-col gap-1">
     <div className="flex items-center justify-between text-[10px] uppercase font-black tracking-widest text-white/40">
        <span>{label}</span>
        <span>x{val.toFixed(2)}</span>
     </div>
     <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
        <div 
          className="h-full bg-blue-500 transition-all duration-1000" 
          style={{ width: `${Math.min(100, (val / 4.0) * 100)}%` }} 
        />
     </div>
  </div>
);

const Row = ({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: LucideIcon }) => (
  <div className="flex items-start justify-between gap-4 min-w-0 py-1.5 border-b border-slate-50 last:border-0">
    <div className="flex items-center gap-2 shrink-0 pt-0.5">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">{label}</span>
    </div>
    <div className="text-xs font-bold text-slate-800 text-right flex-1 min-w-0 wrap-anywhere leading-relaxed">
      {value}
    </div>
  </div>
);
