'use client';

import { useCallback } from 'react';
import type { HelperFormPayload } from '@/lib/oci/optimization-contract';
import type { HunterIntent } from '@/lib/types/hunter';

export function useQueueCommandDispatcher() {
  const buildSealBody = useCallback(
    (
      intent: HunterIntent,
      saleAmount: number | null,
      currency: string,
      leadScore: number,
      callerPhone?: string,
      helperFormPayload?: HelperFormPayload | null
    ) => {
      const finalScore = leadScore >= 100 || leadScore > 5 ? 100 : leadScore * 20;
      const body: Record<string, unknown> = {
        sale_amount: saleAmount ?? null,
        currency,
        lead_score: finalScore,
        action_type: finalScore >= 100 ? 'won' : finalScore >= 80 ? 'offered' : 'contacted',
        helper_form_payload: helperFormPayload ?? null,
        version: typeof intent.version === 'number' && Number.isFinite(intent.version) ? intent.version : 0,
      };
      if (callerPhone?.trim()) {
        body.caller_phone = callerPhone.trim().slice(0, 64);
      }
      return body;
    },
    []
  );

  return { buildSealBody };
}
