'use client';

import React from 'react';
import { LazySessionDrawer } from '@/components/dashboard/lazy-session-drawer';
import { SealModal } from '../SealModal';
import type { QueueControllerActions, QueueControllerState } from '@/lib/hooks/useQueueController';

export function ActionModals({
  siteId,
  state,
  actions,
}: {
  siteId: string;
  state: QueueControllerState;
  actions: QueueControllerActions;
}) {
  return (
    <>
      {/* Seal Modal (Casino Table) */}
      {state.intentForSeal && (
        <SealModal
          open={state.sealModalOpen}
          onOpenChange={(open) => {
            actions.setSealModalOpen(open);
            if (!open) actions.clearSealIntent();
          }}
          currency={state.siteCurrency}
          chipValues={state.bountyChips}
          onConfirm={actions.onSealConfirm}
          onJunk={actions.onSealJunk}
          onSuccess={actions.onSealSuccess}
          onJunkSuccess={actions.onSealJunkSuccess}
          onError={actions.onSealError}
        />
      )}

      {/* Session Drawer */}
      {state.selectedIntent && state.selectedIntent.matched_session_id && (
        <LazySessionDrawer
          siteId={siteId}
          intent={{
            id: state.selectedIntent.id,
            created_at: state.selectedIntent.created_at,
            intent_action: state.selectedIntent.intent_action ?? null,
            intent_target: state.selectedIntent.intent_target ?? null,
            intent_page_url: state.selectedIntent.intent_page_url ?? null,
            intent_stamp: state.selectedIntent.intent_stamp ?? null,
            matched_session_id: state.selectedIntent.matched_session_id,
            lead_score: state.selectedIntent.lead_score ?? null,
            status: state.selectedIntent.status ?? null,
            click_id: state.selectedIntent.click_id ?? null,
          }}
          onClose={actions.closeDrawer}
        />
      )}
    </>
  );
}

