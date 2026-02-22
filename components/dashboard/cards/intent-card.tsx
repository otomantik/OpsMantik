'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatTimestamp } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useIntentQualification } from '@/lib/hooks/use-intent-qualification';
import {
  CheckCircle2,
  FileText,
  MessageCircle,
  Phone,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';

export type IntentCardKind = 'whatsapp' | 'phone' | 'form' | 'other';

export type IntentCardData = {
  id: string;
  created_at: string;
  intent_action: string | null;
  intent_target: string | null;
  intent_page_url: string | null;
  matched_session_id: string | null;
  click_id: string | null;

  // Explainability
  risk_level?: 'low' | 'high' | string | null;
  risk_reasons?: string[] | null;

  // Evidence (best-effort: may be missing depending on RPC/session availability)
  city?: string | null;
  district?: string | null;
  total_duration_sec?: number | null;
  event_count?: number | null;
  attribution_source?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
};

function getKind(action: string | null | undefined): IntentCardKind {
  const a = (action || '').toLowerCase();
  if (a === 'whatsapp') return 'whatsapp';
  if (a === 'phone') return 'phone';
  if (a === 'form') return 'form';
  return 'other';
}

function formatRelative(ts: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (!Number.isFinite(diffMs)) return '—';

  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);

  if (abs < 60) return t('common.justNow');
  const minutes = Math.floor(abs / 60);
  if (minutes < 60) return `${minutes}${t('common.min')} ${t('common.ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t('common.hr')} ${t('common.ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}${t('common.day')} ${t('common.ago')}`;
}

function pickBorder(kind: IntentCardKind): string {
  if (kind === 'whatsapp') return 'border-l-4 border-green-500 bg-green-50/10';
  if (kind === 'phone') return 'border-l-4 border-blue-500 bg-blue-50/10';
  if (kind === 'form') return 'border-l-4 border-purple-500 bg-purple-50/10';
  return 'border-l-4 border-border bg-background';
}

const KIND_ICON: Record<IntentCardKind, React.ComponentType<{ className?: string }>> = {
  whatsapp: MessageCircle,
  phone: Phone,
  form: FileText,
  other: ArrowRight,
};

function toPath(u: string | null | undefined): string {
  if (!u) return '—';
  try {
    return new URL(u).pathname || '/';
  } catch {
    return u;
  }
}

function secondsToHuman(sec: number | null | undefined, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (typeof sec !== 'number' || Number.isNaN(sec)) return '—';
  if (sec < 60) return `${sec}${t('common.sec')}`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}${t('common.min')} ${s}${t('common.sec')}`;
}

function normalizeWho(target: string | null | undefined): { label: string; raw: string } {
  const t = (target || '').trim();
  if (!t) return { label: '—', raw: '' };
  // Common formats: tel:+90..., wa:+90..., tel:unknown
  const noScheme = t.replace(/^(tel:|wa:)/i, '');
  const digits = noScheme.replace(/[^\d+]/g, '');
  return { label: digits || noScheme || t, raw: digits || noScheme || t };
}

export function IntentCard({
  siteId,
  intent,
  onSkip,
  onQualified,
  onOpenSession,
  autoFocusPrimary,
}: {
  siteId: string;
  intent: IntentCardData;
  onSkip?: () => void;
  onQualified?: () => void;
  onOpenSession?: () => void;
  autoFocusPrimary?: boolean;
}) {
  const { t } = useTranslation();
  const kind = getKind(intent.intent_action);
  const Icon = KIND_ICON[kind];

  const riskLevel = (intent.risk_level || 'low').toString().toLowerCase();
  const isHighRisk = riskLevel === 'high';

  const who = useMemo(() => normalizeWho(intent.intent_target), [intent.intent_target]);

  // Keep existing logic: use same qualification hook, but make the UI "game-like".
  // Default score is 3/5; user can bump quickly if needed.
  const [score, setScore] = useState<1 | 2 | 3 | 4 | 5>(3);
  const { qualify, saving, error, clearError } = useIntentQualification(
    siteId,
    intent.id,
    intent.matched_session_id,
    onQualified // Pass refetch for undo success
  );

  const [flash, setFlash] = useState<null | 'sealed' | 'junk'>(null);

  const hasAnyClickId = Boolean(
    (intent.click_id && intent.click_id.trim()) ||
    (intent.gclid && intent.gclid.trim()) ||
    (intent.wbraid && intent.wbraid.trim()) ||
    (intent.gbraid && intent.gbraid.trim())
  );

  const campaignLabel = useMemo(() => {
    if (intent.utm_campaign && intent.utm_campaign.trim()) return intent.utm_campaign.trim();
    if (hasAnyClickId) return 'Google Ads';
    if (intent.attribution_source && intent.attribution_source.trim()) return intent.attribution_source.trim();
    return '—';
  }, [hasAnyClickId, intent.attribution_source, intent.utm_campaign]);

  const keywordLabel = useMemo(() => {
    if (intent.utm_term && intent.utm_term.trim()) return intent.utm_term.trim();
    return '—';
  }, [intent.utm_term]);

  const handleJunk = async () => {
    const res = await qualify({ score, status: 'junk' });
    if (res.success) {
      setFlash('junk');
      setTimeout(() => setFlash(null), 900);
      onQualified?.();
    }
  };

  const handleSeal = async () => {
    const res = await qualify({ score, status: 'confirmed' });
    if (res.success) {
      setFlash('sealed');
      setTimeout(() => setFlash(null), 900);
      onQualified?.();
    }
  };

  return (
    <Card
      className={cn(
        'group relative overflow-hidden',
        pickBorder(kind),
        // subtle entry / hover polish (no framer-motion dependency)
        'transition-all duration-200 will-change-transform',
        'hover:-translate-y-0.5 hover:shadow-md'
      )}
    >
      {/* Instant feedback overlay (acts like a toast but scoped to the card) */}
      {flash && (
        <div
          className={cn(
            'absolute inset-0 z-20 flex items-center justify-center',
            flash === 'sealed'
              ? 'bg-emerald-500/10'
              : 'bg-red-500/10'
          )}
        >
          <div
            className={cn(
              'rounded-xl border px-4 py-2 text-sm font-medium shadow-sm',
              flash === 'sealed'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800'
            )}
          >
            {flash === 'sealed' ? t('hunter.successSealed') : t('hunter.successJunk')}
          </div>
        </div>
      )}

      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-md border',
                  kind === 'whatsapp'
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : kind === 'phone'
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : kind === 'form'
                        ? 'border-purple-200 bg-purple-50 text-purple-700'
                        : 'border-border bg-muted text-muted-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium">
                    {kind === 'whatsapp' ? t('hunter.intentWhatsApp') : kind === 'phone' ? t('hunter.intentPhone') : kind === 'form' ? t('hunter.intentForm') : t('hunter.intentGeneral')}
                  </div>
                  <div className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
                    {formatRelative(intent.created_at, t)}
                  </div>
                  <div className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
                    • {formatTimestamp(intent.created_at, { hour: '2-digit', minute: '2-digit' })} {t('queue.trt')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Risk badge */}
          {isHighRisk ? (
            <Badge className="bg-red-100 text-red-700 border border-red-200">
              <AlertTriangle className="h-3.5 w-3.5 mr-1" />
              {t('hunter.riskHigh')}
            </Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              {t('hunter.riskSafe')}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-0">
        {/* Evidence: WHO */}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">{t('hunter.who')}</div>
            <div className="text-sm font-medium tabular-nums">
              {who.label === '—' ? (
                '—'
              ) : isHighRisk ? (
                <span className="inline-flex items-center gap-1">
                  <span className="tabular-nums">
                    {who.raw.slice(0, Math.max(0, who.raw.length - 4))}
                  </span>
                  <span className="tabular-nums blur-[2px] group-hover:blur-0 transition-all">
                    {who.raw.slice(-4)}
                  </span>
                </span>
              ) : (
                who.label
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {intent.click_id ? (
                <span className="font-mono">click_id: {intent.click_id.slice(0, 14)}{intent.click_id.length > 14 ? '…' : ''}</span>
              ) : (
                <span className="font-mono">click_id: —</span>
              )}
            </div>
          </div>

          {/* Evidence: WHERE + duration (phones want this) */}
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">{t('hunter.where')}</div>
            <div className="text-sm font-medium">
              {(intent.city || '—')}{intent.district ? ` / ${intent.district}` : ''}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('hunter.duration')}: <span className="font-medium tabular-nums">{secondsToHuman(intent.total_duration_sec, t)}</span>
              {' '}• {t('hunter.events')}: <span className="font-medium tabular-nums">{typeof intent.event_count === 'number' ? intent.event_count : '—'}</span>
            </div>
          </div>
        </div>

        {/* Context box */}
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
          <div className="grid gap-2 md:grid-cols-3">
            <div>
              <div className="text-sm text-muted-foreground">{t('hunter.campaign')}</div>
              <div className="text-sm font-medium truncate">{campaignLabel}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">{t('hunter.keyword')}</div>
              <div className="text-sm font-medium truncate">{keywordLabel}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">{t('hunter.page')}</div>
              <div className="text-sm font-medium font-mono truncate">{toPath(intent.intent_page_url)}</div>
            </div>
          </div>
        </div>

        {/* Risk reasons (only when high risk; keep terse) */}
        {isHighRisk && Array.isArray(intent.risk_reasons) && intent.risk_reasons.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60 p-3">
            <div className="text-sm font-medium text-red-800">{t('hunter.whyHighRisk')}</div>
            <ul className="mt-2 space-y-1 text-sm text-red-800/90">
              {intent.risk_reasons.slice(0, 3).map((r, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-red-500/70" />
                  <span className="min-w-0">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Quick score picker (kept for legacy logic, but gamified + optional) */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">{t('hunter.leadQuality')}</div>
          <div className="flex items-center gap-1">
            {([1, 2, 3, 4, 5] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScore(s)}
                disabled={saving}
                className={cn(
                  'h-8 w-8 rounded-md border text-sm font-medium tabular-nums transition-colors',
                  score === s
                    ? 'border-amber-300 bg-amber-100 text-amber-900'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted'
                )}
                aria-pressed={score === s}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Inline error (since we don't have a global toast system) */}
        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">{error}</div>
              <button
                type="button"
                className="text-rose-700 hover:text-rose-900"
                onClick={clearError}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="px-4 py-4">
        <div className="flex w-full items-center gap-2">
          <Button
            variant="ghost"
            className="h-11 flex-1 justify-center border border-transparent text-red-700 hover:bg-red-50 hover:text-red-800"
            onClick={handleJunk}
            disabled={saving}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t('hunter.junk')}
          </Button>

          <Button
            variant="ghost"
            className="h-11 flex-1 justify-center border border-border bg-background text-muted-foreground hover:bg-muted"
            onClick={onSkip}
            disabled={saving}
          >
            {t('hunter.skip')}
          </Button>

          <Button
            variant="default"
            className={cn(
              'h-11 flex-[1.6] justify-center font-semibold',
              'bg-emerald-600 hover:bg-emerald-700 text-white'
            )}
            onClick={handleSeal}
            disabled={saving}
            autoFocus={autoFocusPrimary}
          >
            <CheckCircle2 className="h-5 w-5 mr-2" />
            {t('hunter.sealRealLead')}
          </Button>

          {intent.matched_session_id && (
            <Button
              variant="outline"
              className="h-11"
              onClick={onOpenSession}
              disabled={saving}
              title={t('session.viewHistory')}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

