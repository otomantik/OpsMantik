'use client';

import { useMemo } from 'react';
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
} from 'lucide-react';

export type HunterSourceType = 'whatsapp' | 'phone' | 'form' | 'other';

const ICON_MAP: Record<string, any> = {
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

/** v3: Green = WhatsApp / High Score (>80) / Exact Match; Blue = Phone; Purple = Form */
function sourceStripClass(t: HunterSourceType, isHighIntent?: boolean): string {
  if (t === 'whatsapp' || isHighIntent) return 'border-l-4 border-emerald-500';
  if (t === 'phone') return 'border-l-4 border-blue-500';
  if (t === 'form') return 'border-l-4 border-purple-500';
  return 'border-l-4 border-border';
}

/** Display: `${device_type}` + (device_os ? ` · ${device_os}` : ''). E.g. "Mobile · iOS", "Desktop · Windows". */
function deviceLabel(
  deviceType: string | null | undefined,
  deviceOs?: string | null,
  browser?: string | null
): { icon: any; label: string } {
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

  // Detect specific OS for better UX
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
  const IntentIcon = ICON_MAP[t] || ICON_MAP.other;
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
    return 'Location Unknown';
  }, [districtLabel, cityLabel]);

  const device = useMemo(
    () => deviceLabel(intent.device_type ?? null, intent.device_os ?? null, intent.browser ?? null),
    [intent.device_type, intent.device_os, intent.browser]
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
        'relative overflow-hidden bg-card shadow-md border-border/80 min-h-[460px] flex flex-col',
        sourceStripClass(t, isHighIntent)
      )}
    >
      {/* Header: [ICON] [TIME_AGO]    🔥 HIGH POTENTIAL    [ Score: {score} ] */}
      <CardHeader className="px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={cn(
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border relative',
                t === 'whatsapp' || isHighIntent
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : t === 'phone'
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : t === 'form'
                      ? 'border-purple-200 bg-purple-50 text-purple-700'
                      : 'border-border bg-muted text-muted-foreground'
              )}
            >
              <IntentIcon className="h-4 w-4" />
              {intent.click_id && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border border-white"></span>
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium leading-none truncate flex items-center gap-1.5">
                {relativeTime(intent.created_at)}
                {intent.click_id && (
                  <span className="text-[9px] font-bold text-emerald-600 tracking-tighter uppercase leading-none">
                    Verified
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground truncate">
                {t === 'whatsapp' ? 'WhatsApp' : t === 'phone' ? 'Phone' : t === 'form' ? 'Form' : 'Interest'}
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
            <Badge variant="secondary" className="font-mono font-semibold">
              Score: {displayScore}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 space-y-4 flex-1 overflow-hidden">
        {/* Main grid: INTEL (left) + TARGET (right) */}
        <div className="grid grid-cols-1 gap-3">
          {/* INTEL */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-3 flex items-center justify-between leading-none">
              <div className="flex items-center gap-1.5">
                <span aria-hidden>🕵️</span> AD INTEL
              </div>
              {intent.click_id && (
                <div className="flex items-center gap-1 text-emerald-600">
                  <Icons.check className="h-2.5 w-2.5" />
                  <span>TRACKING ACTIVE</span>
                </div>
              )}
            </div>
            <div className="space-y-2.5 text-sm">
              <div className="flex gap-2">
                <span className="text-slate-500 shrink-0 w-24">Keyword:</span>
                <span className="font-bold text-slate-900 wrap-break-word line-clamp-2">{keywordDisplay}</span>
              </div>
              <div className="flex gap-2 items-center h-5">
                <span className="text-slate-500 shrink-0 w-24">Match:</span>
                {matchTypeDecoded.type !== 'unknown' ? (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] h-5 font-bold uppercase',
                      matchTypeDecoded.highIntent
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : 'bg-slate-200 text-slate-600'
                    )}
                  >
                    {matchDisplay}
                  </Badge>
                ) : (
                  <span className="text-slate-400 font-medium">{matchDisplay}</span>
                )}
              </div>
              <div className="flex gap-3">
                <span className="text-slate-500 shrink-0 w-24">Campaign:</span>
                <span className="text-slate-900 font-medium truncate">{campaignDisplay}</span>
              </div>
            </div>
          </div>

          {/* TARGET */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-3 flex items-center gap-1.5 leading-none">
              <span aria-hidden>👤</span> TARGET ANALYSIS
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="flex gap-3 items-center">
                <div className="h-8 w-8 rounded bg-slate-100 flex items-center justify-center shrink-0">
                  <MapPin className="h-4 w-4 text-slate-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase font-bold text-slate-400 leading-none mb-1">Location</div>
                  <div className="text-slate-900 font-semibold truncate leading-none">{locationDisplay}</div>
                </div>
              </div>

              <div className="flex gap-3 items-center">
                <div className="h-8 w-8 rounded bg-slate-100 flex items-center justify-center shrink-0">
                  <device.icon className="h-4 w-4 text-slate-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase font-bold text-slate-400 leading-none mb-1">Device / OS</div>
                  <div className="text-slate-900 font-semibold truncate leading-none">{device.label}</div>
                </div>
              </div>

              <div className="flex gap-3 items-center">
                <div className="h-8 w-8 rounded bg-slate-100 flex items-center justify-center shrink-0">
                  <Icons.barChart className="h-4 w-4 text-slate-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase font-bold text-slate-400 leading-none mb-1">Network</div>
                  <div className="text-slate-900 font-semibold truncate leading-none">{intent.ads_network || 'Google Ads'}</div>
                </div>
              </div>

              <div className="flex gap-3 items-center">
                <div className="h-8 w-8 rounded bg-slate-100 flex items-center justify-center shrink-0">
                  <Icons.phone className="h-4 w-4 text-slate-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase font-bold text-slate-400 leading-none mb-1">Carrier / ISP</div>
                  <div className="text-slate-900 font-semibold truncate leading-none">{intent.telco_carrier || 'Identifying…'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Sözleşme Değeri */}
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-4 py-2 flex items-center justify-between">
            <div className="text-[10px] uppercase font-bold text-emerald-600">Estimated Value</div>
            <div className="flex items-center gap-2">
              <span className="font-bold tabular-nums text-emerald-700">{estDisplay || '—'}</span>
              {isHighSegment && <Badge className="bg-emerald-600 text-[9px] h-4">VIP</Badge>}
            </div>
          </div>
        </div>
      </CardContent>

      {/* Footer: JUNK | SKIP | SEAL DEAL */}
      <CardFooter className="px-4 pb-4 pt-2 shrink-0">
        <div className="grid w-full grid-cols-3 gap-2">
          <Button
            variant="outline"
            className="h-10 border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors"
            onClick={() => onJunk({ id: intent.id, stars: 0, score: displayScore })}
          >
            <Icons.x className="h-4 w-4 mr-2" />
            JUNK
          </Button>
          <Button
            variant="outline"
            className="h-10 border-slate-200 text-slate-600 hover:bg-slate-50"
            onClick={() => onSkip({ id: intent.id })}
          >
            SKIP
          </Button>
          <Button
            variant="default"
            className="h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-lg shadow-emerald-600/20"
            onClick={() =>
              onSealDeal ? onSealDeal() : onSeal({ id: intent.id, stars: 0, score: displayScore })
            }
            data-testid="hunter-card-seal-deal"
          >
            <Icons.check className="h-4 w-4 mr-1.5" />
            SEAL
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

