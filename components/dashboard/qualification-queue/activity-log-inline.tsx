'use client';

import React from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatActionType } from '@/lib/i18n/mapping';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Undo2, XOctagon } from 'lucide-react';
import { iconForAction, statusBadge } from './utils';

export type ActivityRow = {
  id: string; // call_actions.id
  call_id: string; // calls.id
  at: string; // created_at
  action_type: string;
  actor_type: string;
  previous_status: string | null;
  new_status: string | null;
  intent_action: string | null;
  identity: string | null;
  sale_amount: number | null;
  currency: string | null;
  is_latest_for_call: boolean;
};

export function ActivityLogInline({
  history,
  restoringIds,
  onUndo,
  onCancel,
  readOnly,
}: {
  history: ActivityRow[];
  restoringIds: Set<string>;
  onUndo: (callId: string) => void;
  onCancel: (callId: string) => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">{t('dashboard.activityLog')}</div>
          <p className="text-xs text-slate-500">{t('activity.subtitle')}</p>
        </div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {history.length} {t('activity.rows')}
        </div>
      </div>
      <div className="mt-3 relative max-h-52 overflow-hidden">
        <div className="space-y-2">
          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
              {t('activity.noActionsYet')}
            </div>
          ) : (
            history.map((h, idx) => {
              const Icon = iconForAction(h.intent_action);
              const faded = idx >= 7;
              const isRestoring = restoringIds.has(h.call_id);
              const s = (h.new_status || 'intent').toLowerCase();
              const canUndo = h.is_latest_for_call && (h.action_type || '').toLowerCase() !== 'undo';
              const canCancel = h.is_latest_for_call && ['confirmed', 'qualified', 'real'].includes(s);
              return (
                <div
                  key={`${h.id}-${h.at}`}
                  className={cn(
                    'rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3',
                    faded && 'opacity-60',
                    isRestoring && 'opacity-50'
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className="hidden sm:block text-xs tabular-nums text-muted-foreground w-[52px] shrink-0"
                      suppressHydrationWarning
                    >
                      {formatRelativeTime(h.at)}
                    </div>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white border border-slate-200">
                      <Icon className="h-4 w-4 text-slate-500 shrink-0" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium tabular-nums truncate text-slate-900">{h.identity || '—'}</div>
                      <div className="text-xs text-slate-500">{formatActionType(h.action_type, t)}</div>
                    </div>
                    <div className="sm:hidden text-xs text-muted-foreground shrink-0" suppressHydrationWarning>
                      {formatRelativeTime(h.at)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-start sm:justify-end gap-1.5 w-full sm:w-auto shrink-0">
                    {statusBadge(h.new_status, t)}
                    {canUndo && (
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-slate-100 transition-colors disabled:opacity-50"
                        onClick={() => onUndo(h.call_id)}
                        disabled={isRestoring || readOnly}
                        title={t('activity.undoTitle')}
                      >
                        <Undo2 className="h-3.5 w-3.5 text-slate-600" />
                      </button>
                    )}
                    {canCancel && (
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                        onClick={() => onCancel(h.call_id)}
                        disabled={isRestoring || readOnly}
                        title={t('activity.cancelDealTitle')}
                      >
                        <XOctagon className="h-3.5 w-3.5 text-red-600" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* fade mask */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-b from-transparent to-background" />
      </div>
    </div>
  );
}

