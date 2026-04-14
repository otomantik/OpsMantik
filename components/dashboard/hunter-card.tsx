'use client';

import React, { useMemo } from 'react';
import { cn, safeDecode, formatDisplayLocation } from '@/lib/utils';
import type { HunterIntent } from '@/lib/types/hunter';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { TranslationKey } from '@/lib/i18n/t';
import { Icons } from '@/components/icons';
import {
  Monitor, Smartphone, MapPin, Clock, FileText, Compass, Share2, Leaf, Trash2,
  UserCheck, ShieldCheck, CircleDollarSign, Target, Activity, X, SkipForward,
  type LucideIcon
} from 'lucide-react';
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

function getAnonymousLabel(
  action: string | null | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  const a = (action || '').toLowerCase();
  if (a === 'phone') return t('hunter.anonimCall');
  if (a === 'whatsapp') return t('hunter.anonimWhatsApp');
  return t('hunter.anonimContact');
}

function getPtsGrade(score: number): { color: string; label: string; glow: string } {
  if (score >= 85) return { color: 'text-emerald-400', label: 'HOT', glow: 'shadow-emerald-500/20' };
  if (score >= 65) return { color: 'text-amber-400', label: 'WARM', glow: 'shadow-amber-500/20' };
  if (score >= 40) return { color: 'text-sky-400', label: 'COLD', glow: 'shadow-sky-500/20' };
  return { color: 'text-slate-400', label: 'LOW', glow: 'shadow-slate-500/10' };
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

  if (med === 'organic') return { kind: 'seo', label: t('common.dimension.seo') };
  if (srcLc.includes('google ads') || (srcLc.includes('google') && (med === 'cpc' || med === 'ppc' || med === 'paid'))) {
    return { kind: 'google_ads', label: t('common.dimension.googleAds') };
  }
  if (med === 'social' || med === 'paid_social' || ['instagram', 'facebook', 'meta', 'tiktok', 'linkedin', 'twitter', 'x'].some((k) => srcLc.includes(k))) {
    if (srcLc.includes('facebook')) return { kind: 'social', label: 'Facebook' };
    if (srcLc.includes('instagram')) return { kind: 'social', label: 'Instagram' };
    if (srcLc.includes('tiktok')) return { kind: 'social', label: 'TikTok' };
    if (srcLc.includes('linkedin')) return { kind: 'social', label: 'LinkedIn' };
    return { kind: 'social', label: t('common.dimension.social') };
  }
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

  if (params.hasAnyClickId || attribution.includes('google') || utmSource === 'google') {
    return { kind: 'google_ads', label: t('common.dimension.googleAds') };
  }
  if (attribution.includes('organic') || attribution.includes('seo')) {
    return { kind: 'seo', label: t('common.dimension.seo') };
  }
  if (attribution.includes('social') || ['facebook', 'instagram', 'meta', 'tiktok', 'linkedin'].includes(utmSource)) {
    if (utmSource === 'facebook') return { kind: 'social', label: 'Facebook' };
    if (utmSource === 'instagram') return { kind: 'social', label: 'Instagram' };
    if (utmSource === 'tiktok') return { kind: 'social', label: 'TikTok' };
    return { kind: 'social', label: t('common.dimension.social') };
  }
  if (attribution.includes('direct')) return { kind: 'direct', label: t('common.dimension.direct') };
  if (attribution.includes('referral')) return { kind: 'referral', label: t('common.dimension.referral') };
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

// ─── TRAFFIC SOURCE BADGE ───────────────────────────────────────
function SourcePill({ kind, label }: { kind: string; label: string }) {
  if (!label || label === '—') return null;
  const styles: Record<string, string> = {
    google_ads: 'bg-red-500/10 text-red-400 border-red-500/20',
    seo:        'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    social:     'bg-blue-500/10 text-blue-400 border-blue-500/20',
    direct:     'bg-slate-500/10 text-slate-400 border-slate-500/20',
    referral:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
    other:      'bg-slate-600/10 text-slate-500 border-slate-600/20',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', styles[kind] || styles.other)}>
      {label}
    </span>
  );
}

// ─── DATA ROW ────────────────────────────────────────────────────
function DataRow({ label, value, urgent }: { label: string; value: React.ReactNode; urgent?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 shrink-0 pt-0.5">{label}</span>
      <span className={cn('text-[11px] font-semibold text-right leading-tight', urgent ? 'text-emerald-400' : 'text-slate-200')}>{value || '—'}</span>
    </div>
  );
}

// ─── MAIN CARD ────────────────────────────────────────────────────
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

  // Quantum Intelligence Score
  const intel = useMemo(() => {
    return computeLcv({
      stage: 'V3',
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
      isReturning: intent.is_returning,
    });
  }, [intent, traffic_source, traffic_medium]);

  const displayScore = intel.singularityScore;
  const ptsGrade = getPtsGrade(displayScore);
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

  const hasAnyClickId = Boolean(
    (intent.click_id && intent.click_id.trim()) ||
    (intent.gclid && intent.gclid.trim()) ||
    (intent.wbraid && intent.wbraid.trim()) ||
    (intent.gbraid && intent.gbraid.trim())
  );

  const sourceInfo = useMemo(
    () => resolveTraffic({
      trafficSource,
      trafficMedium,
      attributionSource: intent.attribution_source ?? null,
      utmSource: intent.utm_source ?? null,
      hasAnyClickId,
    }, translate),
    [hasAnyClickId, intent.attribution_source, intent.utm_source, trafficMedium, trafficSource, translate]
  );

  const keywordDisplay = useMemo(() => safeDecode((intent.utm_term || '').trim()) || '—', [intent.utm_term]);
  const pageDisplay = useMemo(
    () => getPageLabel(intent.intent_page_url || intent.page_url, translate),
    [intent.intent_page_url, intent.page_url, translate]
  );

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
    return '—';
  }, [intent.event_count, intent.phone_clicks, intent.total_duration_sec, intent.whatsapp_clicks, sourceType, translate]);

  const liveEvDisplay = useMemo(() => {
    const ev = intent.estimated_value;
    const cur = (intent.currency || 'TRY').trim().toUpperCase();
    if (ev == null || !Number.isFinite(ev) || ev < 0) return null;
    return `${ev.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${cur}`;
  }, [intent.estimated_value, intent.currency]);

  const campaignDisplay = useMemo(() => {
    if (intent.utm_campaign && intent.utm_campaign.trim()) return intent.utm_campaign.trim();
    if (hasAnyClickId) return translate('common.dimension.googleAds');
    return null;
  }, [hasAnyClickId, intent.utm_campaign, translate]);

  return (
    <div className={cn(
      'relative bg-slate-900 border border-slate-700/60 rounded-2xl overflow-hidden',
      'shadow-2xl shadow-black/40 transition-all duration-300',
      'animate-in fade-in slide-in-from-bottom-4 duration-500'
    )}>

      {/* ── INTEL HUD OVERLAY ─────────────────────────── */}
      {showIntel && (
        <div className="absolute inset-0 z-50 bg-slate-900/98 backdrop-blur-sm rounded-2xl flex flex-col p-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500 mb-1">Singularity Engine</div>
              <h4 className="text-lg font-black text-white">Quantum Intel Score</h4>
            </div>
            <button
              onClick={() => setShowIntel(false)}
              className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center hover:bg-slate-700 transition-colors"
            >
              <X className="h-3.5 w-3.5 text-slate-400" />
            </button>
          </div>

          <div className="flex items-center gap-6 mb-6 p-4 rounded-xl bg-slate-800/60 border border-slate-700/50">
            <div>
              <div className={cn('text-6xl font-black tabular-nums leading-none', ptsGrade.color)}>{displayScore}</div>
              <div className={cn('text-xs font-black uppercase tracking-widest mt-1', ptsGrade.color)}>{ptsGrade.label}</div>
            </div>
            <div className="flex-1 space-y-3">
              <IntelBar label="Location" val={intel.breakdown.qLocation} max={4} />
              <IntelBar label="Device" val={intel.breakdown.qDevice} max={4} />
              <IntelBar label="Source" val={intel.breakdown.qSource} max={4} />
              <IntelBar label="Behavior" val={intel.breakdown.qBehavior} max={4} />
            </div>
          </div>

          <p className="text-[10px] text-slate-600 leading-relaxed">
            Score calculated from session duration, device OS, district premium, and search intent signals.
          </p>
        </div>
      )}

      {/* ── TOP BAR ───────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950/40">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
            {translate('common.justNow') === relativeTime(intent.created_at, translate)
              ? 'LIVE'
              : relativeTime(intent.created_at, translate).toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {intent.is_returning && (
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase tracking-widest">
              Returning
            </span>
          )}
          <SourcePill kind={sourceInfo.kind} label={sourceInfo.label} />
        </div>
      </div>

      {/* ── IDENTITY BLOCK ─────────────────────────────── */}
      <div className="px-5 pt-5 pb-4 border-b border-slate-800">
        <div className="flex items-start justify-between gap-4">

          {/* Left: Icon + Identity */}
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
              <IntentIcon className="h-5 w-5 text-slate-300" />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-black text-white tracking-tight leading-tight truncate">
                {identityDisplay}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <MapPin className="h-3 w-3 text-slate-500 shrink-0" />
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  {geoDisplay}
                </span>
              </div>
            </div>
          </div>

          {/* Right: PTS Score */}
          <button
            onClick={() => setShowIntel(true)}
            className={cn(
              'shrink-0 flex flex-col items-center px-3 py-2 rounded-xl border transition-all hover:scale-105 active:scale-95',
              'bg-slate-800 border-slate-700 hover:border-slate-600',
              `shadow-lg ${ptsGrade.glow}`
            )}
          >
            <span className={cn('text-2xl font-black leading-none tabular-nums', ptsGrade.color)}>
              {displayScore}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">PTS</span>
          </button>
        </div>
      </div>

      {/* ── DATA GRID ─────────────────────────────────── */}
      <div className="px-5 py-4 space-y-0">
        <DataRow label={translate('hunter.sessionActions')} value={actionsDisplay} />
        {keywordDisplay && keywordDisplay !== '—' && (
          <DataRow label={translate('hunter.keyword')} value={keywordDisplay} />
        )}
        {campaignDisplay && (
          <DataRow label={translate('hunter.campaign')} value={campaignDisplay} />
        )}
        <DataRow label={translate('hunter.device')} value={device.label} />
        <DataRow label={translate('hunter.page')} value={pageDisplay} />
        {liveEvDisplay && (
          <DataRow label="Değer" value={liveEvDisplay} urgent />
        )}
        {intent.ai_summary && (
          <div className="pt-3 mt-1 flex items-start gap-2">
            <Activity className="h-3.5 w-3.5 text-sky-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-slate-300 leading-relaxed">{intent.ai_summary}</p>
          </div>
        )}
      </div>

      {/* ── ACTION BAR ────────────────────────────────── */}
      <div className="px-4 pb-4 pt-2 border-t border-slate-800 grid grid-cols-4 gap-2">
        {/* Junk */}
        <button
          onClick={() => onJunk({ id: intent.id, score: displayScore })}
          disabled={Boolean(readOnly)}
          className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:bg-red-950/60 hover:border-red-800/60 hover:text-red-400 text-slate-500 transition-all disabled:opacity-40 active:scale-95"
          title={translate('hunter.markJunk')}
        >
          <Trash2 className="h-4 w-4" />
          <span className="text-[9px] font-black uppercase tracking-wider">{translate('hunter.junk')}</span>
        </button>

        {/* Skip */}
        <button
          onClick={() => onSkip({ id: intent.id })}
          className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:bg-slate-700 hover:text-slate-200 text-slate-500 transition-all active:scale-95"
          title={translate('hunter.skip')}
        >
          <SkipForward className="h-4 w-4" />
          <span className="text-[9px] font-black uppercase tracking-wider">{translate('hunter.skip')}</span>
        </button>

        {/* Qualify */}
        {onQualify ? (
          <button
            onClick={() => onQualify({ score: 60, status: 'confirmed' })}
            disabled={Boolean(readOnly)}
            className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:bg-sky-950/60 hover:border-sky-800/60 hover:text-sky-400 text-slate-500 transition-all disabled:opacity-40 active:scale-95"
            title={translate('hunter.gorusuldu')}
          >
            <UserCheck className="h-4 w-4" />
            <span className="text-[9px] font-black uppercase tracking-wider">{translate('hunter.gorusuldu')}</span>
          </button>
        ) : (
          <div />
        )}

        {/* SEAL — primary action */}
        <button
          onClick={() => onSealDeal ? onSealDeal() : onSeal({ id: intent.id, score: displayScore })}
          disabled={Boolean(readOnly)}
          className={cn(
            'flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl font-black transition-all active:scale-95 disabled:opacity-40',
            'bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-white shadow-lg shadow-emerald-900/40 hover:shadow-emerald-700/40'
          )}
          data-testid="hunter-card-seal-deal"
          title={translate('hunter.sealLead')}
        >
          <ShieldCheck className="h-4 w-4" />
          <span className="text-[9px] font-black uppercase tracking-wider">{translate('hunter.seal')}</span>
        </button>
      </div>
    </div>
  );
});

HunterCard.displayName = 'HunterCard';

// ─── INTEL HUD SUBCOMPONENTS ─────────────────────────────────────
function IntelBar({ label, val, max }: { label: string; val: number; max: number }) {
  const pct = Math.min(100, (val / max) * 100);
  const colorClass = pct > 75 ? 'bg-emerald-500' : pct > 40 ? 'bg-amber-500' : 'bg-slate-600';
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-700', colorClass)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-bold text-slate-400 w-8 text-right tabular-nums">{val.toFixed(1)}</span>
    </div>
  );
}
