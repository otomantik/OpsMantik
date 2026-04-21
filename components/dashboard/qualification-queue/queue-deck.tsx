'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { HunterIntent, HunterIntentLite } from '@/lib/types/hunter';
import { cn, formatTimestamp } from '@/lib/utils';
import { useIntentQualification } from '@/lib/hooks/use-intent-qualification';
import { peekBorderClass } from './utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

import { IntentCardV2, type IntentCardV2Action } from '../intent-card-v2';

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
    onQualified, // Pass refetch callback for undo success
    intent.version ?? null
  );

  const fireQualify = async (params: { score: number; status: 'confirmed' | 'junk' }) => {
    try {
      const result = await qualify({ ...params, version: intent.version ?? null });
      if (!result.success) {
        pushToast('danger', result.error || t('toast.failedUpdate'));
      } else {
        onOptimisticRemove(intent.id);
        pushHistoryRow({
          id: intent.id,
          status: params.status,
          intent_action: intent.intent_action ?? null,
          identity: intent.intent_target ?? null,
        });
        if (params.status === 'confirmed') {
          pushToast('success', t('seal.dealSealed'));
        } else {
          pushToast('danger', t('toast.trashRemoved'));
        }
      }
      onQualified();
      return result.success;
    } catch (err) {
      pushToast('danger', t('toast.failedUpdate'));
      onQualified();
      return false;
    }
  };

  const handleAction = async (intentId: string, actionId: string, score: number) => {
    if (readOnly) return false;
    
    // special case: seal/seal-deal might require the modal if it's a "Seal" action
    if (actionId === 'seal' && onSealDeal) {
      onSealDeal();
      return true; // we assume modal will handle it and remove it
    }

    return await fireQualify({ score, status: 'confirmed' });
  };

  const handleJunk = async (intentId: string) => {
    if (readOnly) return false;
    return await fireQualify({ score: 0, status: 'junk' });
  };

  const actions: IntentCardV2Action[] = [
    { id: 'contacted', label: t('hunter.contacted'), score: 60, color: 'blue' },
    { id: 'offered', label: t('hunter.offered'), score: 80, color: 'indigo' },
    { id: 'seal', label: t('hunter.seal'), score: 100, color: 'emerald', isPrimary: true },
  ];

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
        <IntentCardV2
          intent={intent}
          actions={actions}
          onAction={handleAction}
          onJunk={handleJunk}
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
      ? [
          phoneClicks > 0 ? `${phoneClicks}× ${t('session.phone')}` : null,
          waClicks > 0 ? `${waClicks}× ${t('event.whatsapp')}` : null,
        ]
        .filter(Boolean)
        .join(' · ')
      : null;

  return (
    <div className="relative group rounded-2xl border border-slate-200 bg-white shadow-sm min-h-[360px] overflow-hidden">
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-100 p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold tracking-tight text-slate-400 tabular-nums">
              {formatTimestamp(intent.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} {t('dashboard.commandCenter.queue.trt')}
            </span>
          </div>
          <div className="line-clamp-2 text-base font-semibold text-slate-900">{summary}</div>
          <div className="mt-2 line-clamp-2 text-sm text-muted-foreground">{actionsLine || t('dashboard.commandCenter.queue.loadingDetails')}</div>
        </div>

        <div className="flex-1 p-4 sm:p-5 space-y-4">
          <div className="space-y-2">
            <div className="h-4 w-32 rounded bg-slate-100" />
            <div className="h-4 w-full max-w-[280px] rounded bg-slate-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-20 rounded-xl border border-slate-100 bg-slate-50" />
            <div className="h-20 rounded-xl border border-slate-100 bg-slate-50" />
          </div>
          <div className="h-28 rounded-xl border border-dashed border-slate-200 bg-slate-50/80" />
        </div>

        <div className="mt-auto p-4 pt-0">
          <div className="grid grid-cols-3 gap-2 w-full">
          <Button variant="outline" size="sm" className="h-10 border-slate-200 font-bold text-[11px]" disabled title={t('dashboard.commandCenter.queue.loadingDetails')}>
            {t('dashboard.commandCenter.queue.junk')}
          </Button>
          <Button variant="outline" size="sm" className="h-10 border-slate-200 font-bold text-[11px]" disabled title={t('dashboard.commandCenter.queue.loadingDetails')}>
            {t('dashboard.commandCenter.queue.skip')}
          </Button>
          <Button size="sm" className="h-10 bg-emerald-600 text-white font-black text-[11px]" disabled title={t('dashboard.commandCenter.queue.loadingDetails')}>
            {t('dashboard.commandCenter.queue.seal')}
          </Button>
          </div>
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
    <div className="relative min-h-[360px]">
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

