'use client';

import React from 'react';
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
}: {
  history: ActivityRow[];
  restoringIds: Set<string>;
  onUndo: (callId: string) => void;
  onCancel: (callId: string) => void;
}) {
  return (
    <div className="relative rounded-lg border border-border bg-background p-3">
      <div className="text-sm font-medium">Activity Log</div>
      <div className="mt-2 relative max-h-44 overflow-hidden">
        <div className="space-y-2">
          {history.length === 0 ? (
            <div className="text-sm text-muted-foreground">No actions yet.</div>
          ) : (
            history.map((h, idx) => {
              const Icon = iconForAction(h.intent_action);
              const faded = idx >= 7;
              const isRestoring = restoringIds.has(h.call_id);
              const s = (h.new_status || 'intent').toLowerCase();
              const canUndo = h.is_latest_for_call && (h.action_type || '').toLowerCase() !== 'undo';
              const canCancel = h.is_latest_for_call && s === 'confirmed';
              return (
                <div
                  key={`${h.id}-${h.at}`}
                  className={cn(
                    'flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2',
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
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="text-sm font-medium tabular-nums truncate">{h.identity || '—'}</div>
                    <div className="text-xs text-muted-foreground shrink-0">{(h.action_type || '').toUpperCase()}</div>
                    <div className="sm:hidden text-xs text-muted-foreground shrink-0" suppressHydrationWarning>
                      {formatRelativeTime(h.at)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-start sm:justify-end gap-1.5 w-full sm:w-auto shrink-0">
                    {statusBadge(h.new_status)}
                    {canUndo && (
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-slate-100 transition-colors disabled:opacity-50"
                        onClick={() => onUndo(h.call_id)}
                        disabled={isRestoring}
                        title="Undo last action"
                      >
                        <Undo2 className="h-3.5 w-3.5 text-slate-600" />
                      </button>
                    )}
                    {canCancel && (
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                        onClick={() => onCancel(h.call_id)}
                        disabled={isRestoring}
                        title="Cancel deal"
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

