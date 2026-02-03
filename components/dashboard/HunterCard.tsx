'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { safeDecode } from '@/lib/utils/string-utils';
import { decodeMatchType, type HunterIntent } from '@/lib/types/hunter';
import { Icons } from '@/components/icons';
import {
  Flame,
  Monitor,
  Smartphone,
  MapPin,
  Cpu,
  Zap,
  MousePointer2,
  Clock,
  ExternalLink,
  ShieldCheck,
  Signal,
  Check,
  type LucideIcon,
} from 'lucide-react';

export type HunterSourceType = 'whatsapp' | 'phone' | 'form' | 'other';

const ICON_MAP: Record<string, LucideIcon> = {
  whatsapp: Icons.whatsapp,
  phone: Icons.phone,
  form: Icons.form,
  other: Icons.sparkles,
};

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

/** Predator HUD v2: Superior accent colors and glass effects */
function getScoreColor(score: number): { border: string; bg: string; text: string; shadow: string } {
  if (score >= 85) return {
    border: 'border-emerald-500/50',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-500',
    shadow: 'shadow-[0_0_20px_rgba(16,185,129,0.2)]'
  };
  if (score >= 50) return {
    border: 'border-amber-500/50',
    bg: 'bg-amber-500/10',
    text: 'text-amber-500',
    shadow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]'
  };
  return {
    border: 'border-slate-500/30',
    bg: 'bg-slate-500/5',
    text: 'text-slate-400',
    shadow: ''
  };
}

function deviceLabel(
  deviceType: string | null | undefined,
  deviceOs?: string | null,
  browser?: string | null
): { icon: LucideIcon; label: string } {
  const d = (deviceType || '').toLowerCase().trim();
  const os = (deviceOs || '').trim();
  const b = (browser || '').trim();
  const osLower = os.toLowerCase();

  let typeLabel = 'Device';
  let Icon = Smartphone;

  if (d.includes('desktop') || d.includes('web')) {
    typeLabel = 'Desktop';
    Icon = Monitor;
  } else if (d.includes('tablet')) {
    typeLabel = 'Tablet';
  } else {
    typeLabel = 'Mobile';
  }

  let detailedOs = os;
  if (osLower.includes('ios') || osLower.includes('iphone')) detailedOs = 'iPhone';
  else if (osLower.includes('android')) detailedOs = 'Android';
  else if (osLower.includes('mac os')) detailedOs = 'MacBook';
  else if (osLower.includes('windows')) detailedOs = 'Windows';

  let label = detailedOs || typeLabel;
  if (b && b !== 'Unknown') {
    label = detailedOs ? `${detailedOs} · ${b}` : `${typeLabel} · ${b}`;
  } else if (detailedOs) {
    label = `${typeLabel} · ${detailedOs}`;
  }

  if (!d && !os && !b) return { icon: Smartphone, label: 'Unknown' };
  return { icon: Icon, label };
}

function formatEstimatedValue(value: number | null | undefined, currency?: string | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const sym = (currency || 'TRY').toUpperCase() === 'TRY' ? '₺' : (currency || '');
  if (value >= 1000) return `${Math.round(value / 1000)}K ${sym}`.trim();
  return `${value} ${sym}`.trim();
}

/** ANIMATED WRAPPER COMPONENTS */
const PulseSignal = ({ children, active }: { children: React.ReactNode, active: boolean }) => (
  <div className="relative inline-flex items-center">
    {children}
    {active && (
      <span className="absolute -right-1 -top-1 flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      </span>
    )}
  </div>
);

const ScanningIcon = ({ icon: Icon, active, className }: { icon: LucideIcon; active: boolean; className?: string }) => (
  <div className={cn("relative overflow-hidden rounded", className)}>
    <Icon className="h-4 w-4 relative z-10" />
    {active && (
      <div className="absolute inset-0 bg-linear-to-b from-transparent via-emerald-400/20 to-transparent animate-scan z-20 pointer-events-none" />
    )}
  </div>
);

/** QUADRANT COMPONENT — Semi-transparent glass panel */
function Quadrant({ title, icon: Icon, children, className }: { title: string; icon: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("p-3 rounded-xl border border-border/50 bg-background/50 dark:bg-background/30 backdrop-blur-md relative overflow-hidden group/quad", className)}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3 w-3 text-muted-foreground transition-all duration-500 group-hover/quad:text-foreground group-hover/quad:scale-110" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 group-hover/quad:text-foreground transition-colors">{title}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value, subValue, icon: Icon, highlight }: { label: string; value: React.ReactNode; subValue?: React.ReactNode; icon?: LucideIcon | React.ReactNode | (() => React.ReactNode); highlight?: boolean }) {
  const iconContent = Icon
    ? (React.isValidElement(Icon)
        ? Icon
        : React.createElement(Icon as React.ComponentType<{ className?: string }>, { className: "h-3 w-3 text-muted-foreground/60 shrink-0 group-hover/field:text-foreground/80" }))
    : <div className="h-3 w-3" />;

  return (
    <div className="flex items-start gap-2.5 min-w-0 group/field">
      <div className="p-1 rounded bg-muted/30 border border-border/20 group-hover/field:border-foreground/20 transition-colors">
        {iconContent}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase font-black text-muted-foreground/50 leading-none mb-1 tracking-tight">{label}</div>
        <div className={cn("text-xs font-bold truncate leading-tight transition-colors", highlight ? "text-foreground" : "text-foreground/80 group-hover/field:text-foreground")}>
          {value || '—'}
        </div>
        {subValue && <div className="text-[9px] text-muted-foreground/60 truncate italic mt-0.5">{subValue}</div>}
      </div>
    </div>
  );
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
  onSealDeal?: () => void;
  onJunk: (params: { id: string; stars: number; score: number }) => void;
  onSkip: (params: { id: string }) => void;
}) {
  const t = sourceTypeOf(intent.intent_action);
  const IntentIcon = ICON_MAP[t] || ICON_MAP.other;
  const matchTypeDecoded = useMemo(() => decodeMatchType(intent.matchtype), [intent.matchtype]);
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
  const isHighPotential = matchTypeDecoded.type === 'exact' || displayScore >= 85;
  const isHighIntent = t === 'whatsapp' || isHighPotential;

  const device = useMemo(
    () => deviceLabel(intent.device_type ?? null, intent.device_os ?? null, intent.browser ?? null),
    [intent.device_type, intent.device_os, intent.browser]
  );

  const estDisplay = useMemo(
    () => formatEstimatedValue(intent.estimated_value, intent.currency),
    [intent.estimated_value, intent.currency]
  );

  const hwSummary = useMemo(() => {
    const parts = [];
    if (intent.device_memory) parts.push(`${intent.device_memory}GB RAM`);
    if (intent.hardware_concurrency) parts.push(`${intent.hardware_concurrency} Cores`);
    return parts.join(' · ') || null;
  }, [intent.device_memory, intent.hardware_concurrency]);

  const locationDisplay = useMemo(() => {
    const districtLabel = safeDecode((intent.district || '').trim());
    const cityLabel = safeDecode((intent.city || '').trim());
    if (districtLabel && cityLabel) return `${districtLabel} / ${cityLabel}`;
    if (districtLabel) return districtLabel;
    if (cityLabel) return cityLabel;
    return 'Location Unknown';
  }, [intent.district, intent.city]);

  return (
    <Card
      className={cn(
        'relative overflow-hidden bg-card/50 dark:bg-card/40 backdrop-blur-xl shadow-2xl border-2 transition-all duration-500 min-h-[500px] flex flex-col group',
        scoreTheme.border,
        scoreTheme.shadow
      )}
    >
      {/* Semi-transparent glass + subtle RGB glow by score (Emerald 90+, Amber 50-89, Slate) */}
      <div className={cn("absolute -top-24 -right-24 w-48 h-48 rounded-full blur-[80px] opacity-25 pointer-events-none", scoreTheme.bg)} />

      {/* HEADER SECTION */}
      <CardHeader className="p-4 pb-2 z-10 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={cn(
              "p-2 rounded-xl border transition-all duration-300 relative",
              isHighIntent ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-muted border-border text-muted-foreground"
            )}>
              <IntentIcon className="h-5 w-5" />
              {intent.click_id && (
                <div className="absolute -top-1 -right-1">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border border-white"></span>
                  </span>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-foreground/90 uppercase tracking-tight">
                  {t === 'whatsapp' ? 'WhatsApp Direct' : t === 'phone' ? 'Phone Inquiry' : t === 'form' ? 'Lead Form' : 'General Intent'}
                </span>
                {intent.is_returning && (
                  <Badge className="bg-blue-500/10 text-blue-500 border-none h-4 text-[9px] px-1.5 font-black uppercase">
                    Returning
                  </Badge>
                )}
                {intent.visitor_rank === 'VETERAN_HUNTER' && (
                  <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-none h-4 text-[9px] px-1.5 font-black uppercase" title="Seen multiple times in last 7 days">
                    {typeof intent.previous_visit_count === 'number' && intent.previous_visit_count > 0
                      ? `High-Frequency (${intent.previous_visit_count + 1} visits)`
                      : 'High-Frequency Visitor'}
                  </Badge>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span suppressHydrationWarning>{relativeTime(intent.created_at)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <div className={cn("text-[10px] font-black uppercase tracking-tighter", scoreTheme.text)}>
              AI CONFIDENCE
            </div>
            <div className={cn("px-2 py-0.5 rounded-full border text-xs font-mono font-black", scoreTheme.border, scoreTheme.bg, scoreTheme.text)}>
              {displayScore}%
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3 flex-1 z-10">
        <div className="grid grid-cols-2 gap-3">
          {/* Q1: ORIGIN (Northwest) — Verified Ads Signal, Keyword, Network Type */}
          <Quadrant title="Origin" icon={Zap}>
            <Field
              label="Keyword"
              value={safeDecode(intent.utm_term || '—')}
              highlight
              icon={() => <ScanningIcon icon={MousePointer2} active={isHighPotential} />}
            />
            <Field
              label="Match Type"
              value={matchTypeDecoded.label}
              icon={ShieldCheck}
            />
            <Field
              label="Network Type"
              value={intent.connection_type || intent.ads_network || '—'}
              icon={Signal}
            />
            <Field
              label="Campaign"
              value={safeDecode(intent.utm_campaign || '—')}
            />
          </Quadrant>

          {/* Q2: IDENTITY (Northeast) — Hardware DNA, Device, ISP, Language, OS */}
          <Quadrant title="Identity" icon={Cpu}>
            <Field
              label="Device / OS"
              value={device.label}
              icon={device.icon}
              highlight
            />
            <Field
              label="Language"
              value={intent.browser_language || '—'}
              icon={Monitor}
            />
            <Field
              label="Hardware DNA"
              value={hwSummary || 'Detecting...'}
              icon={Monitor}
            />
            <Field
              label="Carrier / ISP"
              value={intent.telco_carrier || 'Identifying...'}
              icon={() => <PulseSignal active={!!intent.telco_carrier}><Signal className="h-3 w-3" /></PulseSignal>}
            />
            <Field
              label="Location"
              value={locationDisplay}
              icon={MapPin}
            />
          </Quadrant>

          {/* Q3: BEHAVIOR (Action Pulse) */}
          <Quadrant title="Behavior" icon={MousePointer2}>
            <Field
              label="Engagement"
              value={intent.max_scroll_percentage ? `${intent.max_scroll_percentage}% Page Depth` : 'Low Engagement'}
              icon={() => <ScanningIcon icon={Flame} active={!!(intent.max_scroll_percentage && intent.max_scroll_percentage > 50)} />}
              highlight={!!(intent.max_scroll_percentage && intent.max_scroll_percentage > 70)}
            />
            <Field
              label="Active Time"
              value={intent.total_active_seconds ? `${intent.total_active_seconds}s Focus Time` : 'Idle Browser'}
              icon={Clock}
              highlight={!!(intent.total_active_seconds && intent.total_active_seconds > 30)}
            />
            <Field
              label="Interactions"
              value={`${intent.cta_hover_count || 0} CTA Hovers`}
              icon={Zap}
            />
          </Quadrant>

          {/* Q4: INTELLIGENCE (Southeast) — Lead Confidence Score, Verification */}
          <Quadrant title="Intelligence" icon={ShieldCheck} className={isHighPotential ? "border-amber-500/30 bg-amber-500/5" : ""}>
            <Field
              label="Verification"
              value={intent.click_id ? "GCLID Active" : "No Ad Signal"}
              icon={() => intent.click_id
                ? <span className="text-emerald-500" title="Verified"><Check className="h-3.5 w-3.5 animate-pulse" strokeWidth={3} /></span>
                : <PulseSignal active={false}><ShieldCheck className="h-3 w-3" /></PulseSignal>
              }
              highlight={!!intent.click_id}
            />
            <Field
              label="Referrer Host"
              value={intent.referrer_host || 'Direct / Ad Click'}
              icon={ExternalLink}
            />
            <Field
              label="Lead Potential"
              value={estDisplay || 'Evaluating...'}
              icon={Zap}
              highlight
            />
          </Quadrant>
        </div>

        {/* BOTTOM AI INSIGHT BAR */}
        {intent.ai_summary && (
          <div className="mt-2 p-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 flex gap-2 items-start">
            <span className="text-[10px] p-1 bg-emerald-500 rounded text-white leading-none">AI</span>
            <p className="text-[11px] leading-tight text-emerald-700/80 font-medium">
              {intent.ai_summary}
            </p>
          </div>
        )}
      </CardContent>

      <CardFooter className="p-4 pt-0 gap-2 shrink-0 z-10">
        <div className="grid grid-cols-3 gap-2 w-full">
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-slate-200 hover:bg-rose-50 hover:text-rose-700 transition-all font-bold text-[11px]"
            onClick={() => onJunk({ id: intent.id, stars: 0, score: displayScore })}
          >
            JUNK
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-slate-200 font-bold text-[11px]"
            onClick={() => onSkip({ id: intent.id })}
          >
            SKIP
          </Button>
          <Button
            size="sm"
            className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] shadow-lg shadow-emerald-500/20"
            onClick={() => onSealDeal ? onSealDeal() : onSeal({ id: intent.id, stars: 0, score: displayScore })}
          >
            SEAL
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
