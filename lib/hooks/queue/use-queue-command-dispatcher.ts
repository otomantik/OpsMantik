'use client';

import { useCallback } from 'react';
import type { HunterIntent } from '@/lib/types/hunter';

export function useQueueCommandDispatcher() {
  const buildSealBody = useCallback(
    (
      intent: HunterIntent,
      saleAmount: number | null,
      currency: string,
      leadScore: number,
      callerPhone?: string
    ) => {
      const intentVersion =
        typeof intent.version === 'number' && Number.isFinite(intent.version) && intent.version >= 1
          ? Math.round(intent.version)
          : null;
      if (intentVersion == null) {
        throw new Error('Missing or invalid intent version');
      }

      // Use leadScore directly to support wide data universe (0-100)
      const finalScore = Math.max(0, Math.min(100, Math.round(leadScore)));

      const body: Record<string, unknown> = {
        sale_amount: saleAmount ?? null,
        currency,
        lead_score: finalScore,
        // Status is always 'won' for Seal process
        action_type: 'won',
        version: intentVersion,
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
