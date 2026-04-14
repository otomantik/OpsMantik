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
  Plus, type LucideIcon
} from 'lucide-react';
import { computeLcv } from '@/lib/oci/lcv-engine';
import type { LeadActionType } from './lead-action-overlay';

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

function getPtsGrade(score: number): { color: string; label: string; bg: string } {
  if (score >= 85) return { color: 'text-emerald-600', label: 'HOT', bg: 'bg-emerald-50' };
  if (score >= 65) return { color: 'text-amber-600', label: 'WARM', bg: 'bg-amber-50' };
  if (score >= 40) return { color: 'text-sky-600', label: 'COLD', bg: 'bg-sky-50' };
  return { color: 'text-slate-500', label: 'LOW', bg: 'bg-slate-50' };
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
  readOnly,
}: {
  intent: HunterIntent;
  onAction: (type: LeadActionType) => void;
  readOnly?: boolean;
}) => {
  const { t: translate } = useTranslation();
  const [showIntel, setShowIntel] = React.useState(false);

  const intel = useMemo(() => {
    return computeLcv({
      stage: 'V3',
      baseAov: 1000,
      city: intent.city,
      district: intent.district,
      deviceType: intent.device_type,
      deviceOs: intent.device_os,
      trafficSource: intent.traffic_source,
      trafficMedium: intent.traffic_medium,
      utmTerm: intent.utm_term,
      phoneClicks: intent.phone_clicks,
      whatsappClicks: intent.whatsapp_clicks,
      eventCount: intent.event_count,
      totalDurationSec: intent.total_duration_sec,
      isReturning: intent.is_returning,
    });
  }, [intent]);

  const displayScore = intel.singularityScore;
  const grade = getPtsGrade(displayScore);
  const IntentIcon = ICON_MAP[(intent.intent_action || '').toLowerCase()] || ICON_MAP.other;

  const geoDisplay = useMemo(() => {
    const out = formatDisplayLocation(intent.city || null, intent.district || null, intent.location_source);
    return (out || translate('hunter.locationUnknown')).toLocaleUpperCase('tr-TR');
  }, [intent.city, intent.district, intent.location_source, translate]);

  return (
    <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xl shadow-slate-200/50 flex flex-col relative">
      
      {/* ── INTEL OVERLAY (Light) ──────────────────────── */}
      {showIntel && (
        <div className="absolute inset-0 z-50 bg-white/95 backdrop-blur-md p-8 animate-in fade-in duration-300 rounded-3xl flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <h4 className="text-sm font-black uppercase tracking-widest text-slate-400">Singularity Intelligence</h4>
            <button onClick={() => setShowIntel(false)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200">
              <X size={16} className="text-slate-500" />
            </button>
          </div>
          <div className="flex-1 flex flex-col justify-center items-center text-center">
            <div className={cn('text-7xl font-black tabular-nums', grade.color)}>{displayScore}</div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mt-2">Conversion Probability Score</div>
          </div>
          <p className="text-[10px] text-slate-400 italic text-center leading-relaxed">
            Neural signal processing from duration, geo, and intent patterns.
          </p>
        </div>
      )}

      {/* ── TOP NAV ────────────────────────────────────── */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-slate-50 bg-slate-50/30">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {relativeTime(intent.created_at, translate)}
          </span>
        </div>
        <div 
          onClick={() => setShowIntel(true)}
          className={cn('px-2.5 py-1 rounded-lg border font-black text-[10px] cursor-pointer transition-transform hover:scale-105', grade.bg, grade.color, 'border-current/10')}
        >
          {displayScore} PTS
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
        <EntryRow label="Kaynak" value={intent.attribution_source || intent.traffic_source || 'Organik'} />
        <EntryRow label="Cihaz" value={intent.device_type === 'mobile' ? 'Mobil' : 'Masaüstü'} />
        <EntryRow label="Sayfa" value={intent.page_url?.split('/').pop() || 'Ana Sayfa'} />
        {intent.ai_summary && (
          <div className="mt-4 p-4 bg-blue-50/50 border border-blue-100/50 rounded-2xl">
            <div className="flex items-center gap-2 mb-1.5">
              <Activity size={12} className="text-blue-500" />
              <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">AI Intent</span>
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
          label={translate('hunter.gorusuldu')} 
          onClick={() => onAction('gorusuldu')} 
          className="bg-slate-50 text-slate-400 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-100" 
        />
        <ActionButton 
          icon={Plus} 
          label={translate('hunter.teklif')} 
          onClick={() => onAction('teklif')} 
          className="bg-slate-50 text-slate-400 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-100" 
        />
        <ActionButton 
          icon={ShieldCheck} 
          label={translate('hunter.seal')} 
          onClick={() => onAction('satis')} 
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
