'use client';

/**
 * IntentCardV2 — Kuyruk kartı (v2)
 *
 * Hedef: Operatör 2 saniyede niyeti okur, tek butonla pipeline aksiyonu verir.
 * - Kimlik (telefon/wa numarası) gösterilmez — zaten bilinmiyor.
 * - AI skoru, kampanya ID, click_id, page URL, form state gösterilmez.
 * - Odak: Anahtar kelime · Konum · Cihaz+OS · Saat · Kaynak
 */

import React, { useMemo, useState } from 'react';
import { cn, safeDecode, formatDisplayLocation } from '@/lib/utils';
import { MapPin, Monitor, Smartphone, Clock, Trash2, CheckCircle2 } from 'lucide-react';
import { Icons } from '@/components/icons';
import { Leaf, Share2 } from 'lucide-react';
import type { HunterIntent } from '@/lib/types/hunter';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { TranslationKey } from '@/lib/i18n/t';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntentCardV2Action {
  id: string;
  label: string;
  /** Tailwind color key for theming */
  color?: 'slate' | 'orange' | 'blue' | 'rose' | 'emerald' | 'indigo';
  /** If true, rendered as primary (filled) CTA */
  isPrimary?: boolean;
  /** Numeric score to pass back to caller */
  score: number;
}

export interface IntentCardV2Props {
  intent: HunterIntent;
  actions: IntentCardV2Action[];
  /** Called when an action button is pressed. Return true if successful. */
  onAction: (intentId: string, actionId: string, score: number) => Promise<boolean>;
  /** Called when trash icon is pressed (score 0 → junk). */
  onJunk: (intentId: string) => Promise<boolean>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TrafficKind = 'google_ads' | 'seo' | 'social' | 'direct' | 'other';

function resolveTrafficKind(
  intent: HunterIntent,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): { kind: TrafficKind; label: string } {
  const src = (intent.traffic_source || '').toLowerCase();
  const med = (intent.traffic_medium || '').toLowerCase();
  const hasClickId = Boolean(
    intent.gclid?.trim() || intent.wbraid?.trim() || intent.gbraid?.trim() || intent.click_id?.trim()
  );

  if (hasClickId || src.includes('google ads') || (src.includes('google') && (med === 'cpc' || med === 'ppc' || med === 'paid')))
    return { kind: 'google_ads', label: t('common.dimension.googleAds') };
  if (med === 'organic') return { kind: 'seo', label: t('common.dimension.organic') };
  if (['instagram', 'facebook', 'meta', 'tiktok'].some((k) => src.includes(k)))
    return { kind: 'social', label: src.includes('instagram') ? 'Instagram' : src.includes('facebook') ? 'Facebook' : t('common.dimension.social') };
  if (med === 'direct' || src === 'direct') return { kind: 'direct', label: t('common.dimension.direct') };

  return { kind: 'other', label: src || '—' };
}

function resolveDevice(
  intent: HunterIntent,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): { label: string; icon: typeof Smartphone } {
  const d = (intent.device_type || '').toLowerCase();
  const os = (intent.device_os || '').toLowerCase();

  let icon: typeof Smartphone = Smartphone;
  let type = t('device.mobile');

  if (d.includes('desktop') || d.includes('web')) { type = t('device.desktop'); icon = Monitor; }
  else if (d.includes('tablet')) { type = t('device.tablet'); }

  let osLabel = '';
  if (os.includes('ios') || os.includes('iphone')) osLabel = 'iOS';
  else if (os.includes('android')) osLabel = 'Android';
  else if (os.includes('mac')) osLabel = 'macOS';
  else if (os.includes('windows')) osLabel = 'Windows';

  return { label: osLabel ? `${osLabel} · ${type}` : type, icon };
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function SourceBadge({ intent }: { intent: HunterIntent }) {
  const { t } = useTranslation();
  const { kind, label } = resolveTrafficKind(intent, t);
  if (kind === 'other' && (!label || label === '—')) return null;

  const styles: Record<TrafficKind, { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
    google_ads: { cls: 'bg-orange-50 border-orange-200 text-orange-700', Icon: Icons.google as React.ComponentType<{ className?: string }> },
    seo:        { cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', Icon: Leaf },
    social:     { cls: 'bg-blue-50 border-blue-200 text-blue-700', Icon: Share2 },
    direct:     { cls: 'bg-slate-50 border-slate-200 text-slate-600', Icon: Icons.circleDot as React.ComponentType<{ className?: string }> },
    other:      { cls: 'bg-slate-50 border-slate-200 text-slate-600', Icon: Icons.circleDot as React.ComponentType<{ className?: string }> },
  };

  const { cls, Icon } = styles[kind];

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none', cls)}>
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}

function DevicePill({ intent }: { intent: HunterIntent }) {
  const { t } = useTranslation();
  const { label, icon: DevIcon } = resolveDevice(intent, t);
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 leading-none">
      <DevIcon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}

// ─── Action button colour map ──────────────────────────────────────────────────

const BTN_STYLES: Record<string, string> = {
  slate:   'border-slate-200 text-slate-700 hover:bg-slate-50',
  orange:  'border-orange-200 text-orange-700 hover:bg-orange-50',
  blue:    'border-blue-200 text-blue-700 hover:bg-blue-50',
  rose:    'border-rose-200 text-rose-700 hover:bg-rose-50',
  emerald: 'bg-emerald-500 hover:bg-emerald-600 text-white border-transparent',
  indigo:  'border-indigo-200 text-indigo-700 hover:bg-indigo-50',
};

// ─── Left accent stripe by source ─────────────────────────────────────────────

const ACCENT: Record<TrafficKind, string> = {
  google_ads: 'border-l-orange-400',
  seo:        'border-l-emerald-400',
  social:     'border-l-blue-400',
  direct:     'border-l-slate-300',
  other:      'border-l-slate-200',
};

// ─── Main Component ────────────────────────────────────────────────────────────

export function IntentCardV2({ intent, actions, onAction, onJunk }: IntentCardV2Props) {
  const { t, formatTimestamp, toLocaleUpperCase } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const keyword = useMemo(
    () => safeDecode((intent.utm_term || '').trim()) || t('panel.searchTermUnknown'),
    [intent.utm_term, t]
  );

  const location = useMemo(
    () => toLocaleUpperCase(formatDisplayLocation(intent.city || null, intent.district || null, intent.location_source) || t('hunter.locationUnknown')),
    [intent.city, intent.district, intent.location_source, t, toLocaleUpperCase]
  );

  const time = useMemo(
    () => formatTimestamp(intent.created_at, { hour: '2-digit', minute: '2-digit' }),
    [formatTimestamp, intent.created_at]
  );

  const { kind: trafficKind } = useMemo(() => resolveTrafficKind(intent, t), [intent, t]);
  const accentCls = ACCENT[trafficKind];

  const handleAction = async (action: IntentCardV2Action) => {
    if (submitting) return;
    setSubmitting(true);
    const ok = await onAction(intent.id, action.id, action.score);
    if (ok) setDone(true);
    else setSubmitting(false);
  };

  const handleJunk = async () => {
    if (submitting) return;
    setSubmitting(true);
    const ok = await onJunk(intent.id);
    if (ok) setDone(true);
    else setSubmitting(false);
  };

  // ── Done state: kart solar ve kaybolur ──
  if (done) {
    return (
      <div className={cn(
        'flex items-center justify-between rounded-2xl border-l-4 border border-slate-100 bg-slate-50/60 px-4 py-3 mb-3',
        'animate-out fade-out slide-out-to-top-2 duration-500 opacity-40',
        accentCls
      )}>
        <span className="text-sm font-bold text-slate-400 line-through decoration-slate-300">{keyword}</span>
        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative rounded-2xl border border-slate-200 border-l-4 bg-white shadow-sm mb-3 overflow-hidden transition-all duration-200',
        submitting && 'opacity-60 pointer-events-none',
        accentCls
      )}
    >
      {/* ── Top bar: saat (sol) + kaynak badge (sağ) ── */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0 gap-2">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[12px] font-bold tabular-nums tracking-tight" suppressHydrationWarning>
            {time}
          </span>
        </div>
        <SourceBadge intent={intent} />
      </div>

      {/* ── Anahtar kelime (ana başlık) ── */}
      <div className="px-4 pt-2.5 pb-0">
        <h3 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight tracking-tight">
          {keyword}
        </h3>
      </div>

      {/* ── Konum + Cihaz satırı ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-1.5 pb-3">
        <div className="flex items-center gap-1 text-blue-600">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[13px] font-black uppercase tracking-wide leading-none">
            {location}
          </span>
        </div>
        <DevicePill intent={intent} />
      </div>

      {/* ── Ayırıcı ── */}
      <div className="mx-4 border-t border-slate-100" />

      {/* ── Aksiyon butonları ── */}
      <div className="flex items-center gap-1.5 flex-wrap px-3 py-3">
        {/* Çöp butonu — küçük, sol köşe */}
        <button
          onClick={handleJunk}
          disabled={submitting}
          title={t('hunter.markJunk')}
          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        {/* Spacer */}
        <div className="flex-1 flex gap-1.5 flex-wrap justify-end">
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={() => handleAction(action)}
              disabled={submitting}
              className={cn(
                'rounded-xl border-2 px-4 py-2.5 text-sm font-bold transition-all shadow-sm',
                BTN_STYLES[action.color || (action.isPrimary ? 'emerald' : 'slate')]
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
