'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { HunterIntent, HunterIntentLite } from '@/lib/types/hunter';
import { cn, formatTimestamp } from '@/lib/utils';
import { HunterCard } from '../hunter-card';
import { useIntentQualification } from '@/lib/hooks/use-intent-qualification';
import { peekBorderClass } from './utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

function ActiveDeckCard({
  siteId,
  intent,
  readOnly,
  onOpenDetails,
  onOptimisticRemove,
  onQualified,
  onSkip,
  onSealDeal,
  pushToast,
  pushHistoryRow,
}: {
  siteId: string;
  intent: HunterIntent; // full intent preferred for the heavy HunterCard view
  readOnly: boolean;
  onOpenDetails: (callId: string) => void;
  onOptimisticRemove: (id: string) => void;
  onQualified: () => void;
  onSkip: () => void;
  onSealDeal?: () => void;
  pushToast: (kind: 'success' | 'danger', text: string) => void;
  pushHistoryRow: (row: { id: string; status: 'confirmed' | 'junk'; intent_action: string | null; identity: string | null }) => void;
}) {
  const { t } = useTranslation();
  // Hook must be called unconditionally (no conditional wrapper).
  const { qualify, saving } = useIntentQualification(
    siteId,
    intent.id,
    intent.matched_session_id ?? null,
    onQualified // Pass refetch callback for undo success
  );

  const fireQualify = (params: { score: 0 | 1 | 2 | 3 | 4 | 5; status: 'confirmed' | 'junk' }, optimistic = false) => {
    if (optimistic) {
      onOptimisticRemove(intent.id);
      pushHistoryRow({
        id: intent.id,
        status: 'confirmed',
        intent_action: intent.intent_action ?? null,
        identity: intent.intent_target ?? null,
      });
      pushToast('success', t('seal.dealSealed'));
    }
    void qualify(params)
      .then(() => {
        onQualified();
      })
      .catch(() => {
        pushToast('danger', t('toast.failedUpdate'));
        onQualified();
      });
  };

  const handleQualify = (params: { score: 4 | 5; status: 'confirmed' }) => {
    fireQualify(params, true);
  };

  const handleSeal = ({ id, stars }: { id: string; stars: number }) => {
    const s = Math.min(5, Math.max(1, Number(stars || 0))) as 1 | 2 | 3 | 4 | 5;
    // Step 1: remove immediately
    onOptimisticRemove(id);
    // Step 2: toast + history immediately
    pushHistoryRow({
      id,
      status: 'confirmed',
      intent_action: intent.intent_action ?? null,
      identity: intent.intent_target ?? null,
    });
    pushToast('success', t('toast.captured'));
    // Step 3: async update in background
    fireQualify({ score: s, status: 'confirmed' });
  };

  const handleJunk = ({ id }: { id: string; stars?: number }) => {
    onOptimisticRemove(id);
    pushHistoryRow({
      id,
      status: 'junk',
      intent_action: intent.intent_action ?? null,
      identity: intent.intent_target ?? null,
    });
    pushToast('danger', t('toast.trashRemoved'));
    // Junk should be score=0 (0-100 lead_score = 0) to avoid polluting OCI value logic.
    fireQualify({ score: 0, status: 'junk' }, false);
  };

  return (
    <div className={cn(saving && 'opacity-60 pointer-events-none')}>
      <div
        onClickCapture={(e) => {
          const el = e.target as HTMLElement | null;
          // Don't open drawer when clicking action buttons inside the card.
          if (el && (el.closest('button') || el.getAttribute('role') === 'button')) return;
          onOpenDetails(intent.id);
        }}
      >
        <HunterCard
          intent={intent}
          traffic_source={intent.traffic_source ?? null}
          traffic_medium={intent.traffic_medium ?? null}
          onSeal={({ id, stars }) => handleSeal({ id, stars })}
          onSealDeal={onSealDeal}
          onJunk={({ id }) => handleJunk({ id })}
          onSkip={() => onSkip()}
          onQualify={handleQualify}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

function LiteDeckCard({
  intent,
  onOpenDetails,
  onSkip,
}: {
  intent: HunterIntentLite;
  onOpenDetails: (callId: string) => void;
  onSkip: () => void;
}) {
  void onOpenDetails;
  void onSkip;
  const { t } = useTranslation();
  const summary = intent.summary || t('dashboard.commandCenter.queue.loadingDetails');
  const phoneClicks = typeof intent.phone_clicks === 'number' ? intent.phone_clicks : 0;
  const waClicks = typeof intent.whatsapp_clicks === 'number' ? intent.whatsapp_clicks : 0;
  const actionsLine =
    phoneClicks > 0 || waClicks > 0
      ? [phoneClicks > 0 ? `${phoneClicks}× phone` : null, waClicks > 0 ? `${waClicks}× WhatsApp` : null]
        .filter(Boolean)
        .join(' · ')
      : null;

  return (
    <div className="relative group">
      <div className="flex items-center justify-between gap-4 p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold tracking-tight text-slate-400 tabular-nums">
              {formatTimestamp(intent.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} {t('dashboard.commandCenter.queue.trt')}
            </span>
          </div>
          <div className="mt-2 text-sm font-medium truncate">{summary}</div>
          <div className="mt-2 text-xs text-muted-foreground">{actionsLine || t('dashboard.commandCenter.queue.loadingDetails')}</div>
        </div>
      </div>

      <div className="p-3 pt-0">
        <div className="grid grid-cols-3 gap-2 w-full">
          <Button variant="outline" size="sm" className="h-9 border-slate-200 font-bold text-[11px]" disabled title={t('dashboard.commandCenter.queue.loadingDetails')}>
            {t('dashboard.commandCenter.queue.junk')}
          </Button>
          <Button variant="outline" size="sm" className="h-9 border-slate-200 font-bold text-[11px]" disabled title={t('dashboard.commandCenter.queue.loadingDetails')}>
            {t('dashboard.commandCenter.queue.skip')}
          </Button>
          <Button size="sm" className="h-9 bg-emerald-600 text-white font-black text-[11px]" disabled title={t('dashboard.commandCenter.queue.loadingDetails')}>
            {t('dashboard.commandCenter.queue.seal')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function QueueDeck({
  siteId,
  mergedTop,
  topLite,
  mergedNext,
  readOnly,
  onOpenDetails,
  onOptimisticRemove,
  onQualified,
  onSkip,
  onSealDeal,
  pushToast,
  pushHistoryRow,
}: {
  siteId: string;
  mergedTop: HunterIntent | null;
  topLite: HunterIntentLite | null;
  mergedNext: HunterIntentLite | null;
  readOnly: boolean;
  onOpenDetails: (callId: string) => void;
  onOptimisticRemove: (id: string) => void;
  onQualified: () => void;
  onSkip: () => void;
  onSealDeal: () => void;
  pushToast: (kind: 'success' | 'danger', text: string) => void;
  pushHistoryRow: (row: { id: string; status: 'confirmed' | 'junk'; intent_action: string | null; identity: string | null }) => void;
}) {
  return (
    <div className="relative min-h-[420px]">
      {/* Next card (peek): render a lightweight placeholder only (no text bleed). */}
      {mergedNext && (
        <div
          className={cn('pointer-events-none absolute inset-0 -z-10', 'scale-95 -translate-y-2', 'transition-transform duration-200')}
          aria-hidden
        >
          <div className={cn('h-full w-full rounded-lg border border-border bg-card shadow-sm', peekBorderClass(mergedNext.intent_action))} />
        </div>
      )}

      {mergedTop ? (
        <div className="relative z-10 transition-all duration-200">
          <ActiveDeckCard
            siteId={siteId}
            intent={mergedTop}
            readOnly={readOnly}
            onOpenDetails={onOpenDetails}
            onOptimisticRemove={onOptimisticRemove}
            onQualified={onQualified}
            onSkip={onSkip}
            onSealDeal={onSealDeal}
            pushToast={pushToast}
            pushHistoryRow={pushHistoryRow}
          />
        </div>
      ) : topLite ? (
        <div className="relative z-10 transition-all duration-200">
          <LiteDeckCard intent={topLite} onOpenDetails={onOpenDetails} onSkip={onSkip} />
        </div>
      ) : null}
    </div>
  );
}

