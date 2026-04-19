'use client';

import React, { useMemo } from 'react';
import { cn, safeDecode, formatDisplayLocation } from '@/lib/utils';
import type { HunterIntent } from '@/lib/types/hunter';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { TranslationKey } from '@/lib/i18n/t';
import { Icons } from '@/components/icons';
import {
  MapPin, Trash2, UserCheck, ShieldCheck, Activity, Plus, type LucideIcon
} from 'lucide-react';
import type { LeadActionType } from './lead-action-overlay';
import { useSiteTimezone } from '@/components/context/site-locale-context';

export type HunterSourceType = 'whatsapp' | 'phone' | 'form' | 'other';

const ICON_MAP: Record<string, LucideIcon> = {
  whatsapp: Icons.whatsapp,
  phone: Icons.phone,
  form: Icons.form,
  other: Icons.sparkles,
};

function formatTimeDisplay(
  ts: string,
  locale: string,
  timeZone: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  const d = new Date(ts);

  // Render in the active site's timezone so HunterCard's time matches the rest
  // of the dashboard clock instead of a hardcoded TRT value.
  const fullTime = d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (!Number.isFinite(diffMs)) return fullTime;
  
  const diffSec = Math.max(0, Math.round(diffMs / 1000));
  let relative = '';
  
  if (diffSec < 60) relative = t('common.justNow');
  else if (diffSec < 3600) {
    const min = Math.round(diffSec / 60);
    relative = `${min}${t('common.min')} ${t('common.ago')}`;
  } else if (diffSec < 86400) {
    const hr = Math.round(diffSec / 3600);
    relative = `${hr}${t('common.hr')} ${t('common.ago')}`;
  } else {
    const day = Math.round(diffSec / 86400);
    relative = `${day}${t('common.day')} ${t('common.ago')}`;
  }

  return `${fullTime} (${relative})`;
}

function normalizeUrl(url: string | null | undefined, homepageLabel: string): string {
  if (!url) return homepageLabel;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.pathname === '/' ? homepageLabel : u.pathname;
  } catch {
    // Fallback: remove query params manually
    return url.split('?')[0].split('#')[0] || homepageLabel;
  }
}

function EntryRow({ label, value, urgent }: { label: string; value: React.ReactNode; urgent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">{label}</span>
      <span className={cn('text-[11px] font-bold text-right truncate ml-4', urgent ? 'text-emerald-600' : 'text-slate-700')}>{value || '—'}</span>
    </div>
  );
}

export const HunterCard = React.memo(({
  intent,
  onAction,
}: {
  intent: HunterIntent;
  onAction: (type: LeadActionType) => void;
}) => {
  const { t: translate, locale, toLocaleUpperCase } = useTranslation();
  const siteTimezone = useSiteTimezone();
  const IntentIcon = ICON_MAP[(intent.intent_action || '').toLowerCase()] || ICON_MAP.other;

  const geoDisplay = useMemo(() => {
    const out = formatDisplayLocation(intent.city || null, intent.district || null, intent.location_source);
    return toLocaleUpperCase(out || translate('hunter.locationUnknown'));
  }, [intent.city, intent.district, intent.location_source, toLocaleUpperCase, translate]);

  const deviceDisplay = useMemo(() => {
    const type = intent.device_type === 'mobile' ? translate('device.mobile') : translate('device.desktop');
    let os = intent.device_os || '';
    if (os.toLowerCase() === 'adroid') os = 'Android'; 
    
    return [type, os, intent.browser].filter(Boolean).join(' / ');
  }, [intent.device_type, intent.device_os, intent.browser, translate]);

  const sourceDisplay = useMemo(() => {
    const attribution = (intent.attribution_source || '').toLowerCase();
    const adsAssistedPattern = /ads[\s-]*assisted/;
    if (adsAssistedPattern.test(attribution)) {
      return 'Google Ads';
    }
    return intent.attribution_source || intent.traffic_source || translate('common.dimension.organic');
  }, [intent.attribution_source, intent.traffic_source, translate]);

  return (
    <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xl shadow-slate-200/50 flex flex-col relative">

      {/* ── TOP NAV ────────────────────────────────────── */}
      <div className="px-6 py-4 flex items-center border-b border-slate-50 bg-slate-50/30">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {formatTimeDisplay(intent.created_at, locale, siteTimezone, translate)}
          </span>
        </div>
      </div>

      {/* ── HEADER ─────────────────────────────────────── */}
      <div className="px-6 py-6 border-b border-slate-50">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
            <IntentIcon size={24} className="text-slate-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-2xl font-black text-slate-900 leading-none truncate tracking-tight uppercase">
              {safeDecode((intent.utm_term || '').trim()) || (intent.intent_target ? intent.intent_target : translate('hunter.anonimContact'))}
            </h3>
            <div className="flex items-center gap-1.5 mt-2">
              <MapPin size={12} className="text-slate-400" />
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{geoDisplay}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── DATA ───────────────────────────────────────── */}
      <div className="px-6 py-4 flex-1">
        <EntryRow label={translate('common.dimension.source')} value={sourceDisplay} />
        <EntryRow label={translate('common.dimension.device')} value={deviceDisplay} />
        <EntryRow label={translate('common.dimension.page')} value={normalizeUrl(intent.page_url, translate('hunter.homepage'))} />
        {intent.ai_summary && (
          <div className="mt-4 p-4 bg-blue-50/50 border border-blue-100/50 rounded-2xl">
            <div className="flex items-center gap-2 mb-1.5">
              <Activity size={12} className="text-blue-500" />
              <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">{translate('hunter.aiIntent')}</span>
            </div>
            <p className="text-[11px] font-bold italic text-slate-600 leading-relaxed">{intent.ai_summary}</p>
          </div>
        )}
      </div>

      {/* ── ACTIONS ────────────────────────────────────── */}
      <div className="px-5 pb-5 pt-3 grid grid-cols-4 gap-2">
        <ActionButton 
          icon={Trash2} 
          label={translate('hunter.junk')} 
          onClick={() => onAction('junk')} 
          className="bg-slate-50 text-slate-400 hover:bg-red-50 hover:text-red-600 hover:border-red-100" 
        />
        <ActionButton 
          icon={UserCheck} 
          label={translate('hunter.contacted')} 
          onClick={() => onAction('contacted')} 
          className="bg-slate-50 text-slate-400 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-100" 
        />
        <ActionButton 
          icon={Plus} 
          label={translate('hunter.offered')} 
          onClick={() => onAction('offered')} 
          className="bg-slate-50 text-slate-400 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-100" 
        />
        <ActionButton 
          icon={ShieldCheck} 
          label={translate('hunter.seal')} 
          onClick={() => onAction('won')} 
          className="bg-slate-900 text-white hover:bg-emerald-600" 
        />
      </div>
    </div>
  );
});

HunterCard.displayName = 'HunterCard';

function ActionButton({ icon: Icon, label, onClick, className }: { icon: LucideIcon; label: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn('flex flex-col items-center justify-center gap-2 py-4 rounded-2xl border border-transparent transition-all active:scale-95', className)}
    >
      <Icon size={18} />
      <span className="text-[9px] font-black uppercase tracking-wider leading-none">{label}</span>
    </button>
  );
}
