/**
 * OpsMantik Signal Emitter
 *
 * Delegates to MizanMantikOrchestrator. No longer does valuation math.
 * Maps legacy SignalType → OpsGear, calls evaluateAndRouteSignal.
 */

import { evaluateAndRouteSignal, resolveGearFromLegacy } from '@/lib/domain/mizan-mantik';
import type { LegacySignalType } from '@/lib/domain/mizan-mantik';

export type SignalType = LegacySignalType;

export interface EmitSignalParams {
  siteId: string;
  callId?: string | null;
  signalType: SignalType;
  conversionName?: string;
  aov: number;
  clickDate: Date;
  signalDate?: Date;
  /** For V2 dedup: gclid from primary source if no call_id */
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
}

/**
 * Emit signal — delegates to MizanMantikOrchestrator.evaluateAndRouteSignal.
 * V2 dedup: returns null if dropped (same call_id or site_id+gclid within 24h).
 */
export async function emitSignal(params: EmitSignalParams): Promise<{
  id?: string | null;
  signalType: SignalType;
  conversionName: string;
  dropped?: boolean;
} | null> {
  const { siteId, callId, signalType, conversionName, aov, clickDate, signalDate, gclid, wbraid, gbraid } = params;

  const gear = resolveGearFromLegacy(signalType);
  const sigDate = signalDate ?? new Date();

  const payload = {
    siteId,
    callId,
    gclid,
    wbraid,
    gbraid,
    aov: Number.isFinite(aov) ? aov : 100,
    clickDate: clickDate instanceof Date ? clickDate : new Date(clickDate),
    signalDate: sigDate,
    conversionName: conversionName ?? `OpsMantik_${signalType}`,
  };

  const result = await evaluateAndRouteSignal(gear, payload);

  if (result.dropped) return null;

  if (!result.routed) {
    throw new Error('MizanMantik: sinyal matrise yazılamadı.');
  }

  return {
    id: result.signalId ?? null,
    signalType,
    conversionName: payload.conversionName,
  };
}
