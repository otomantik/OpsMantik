/**
 * @deprecated DELETED_SIGNAL_EMITTER — Phase 3 cancer cell removal.
 * Use evaluateAndRouteSignal from lib/domain/mizan-mantik directly.
 * This stub throws on any use.
 */
function throwDeleted(): never {
  throw new Error(
    'DELETED_SIGNAL_EMITTER: signal-emitter.ts was removed. Use evaluateAndRouteSignal from @/lib/domain/mizan-mantik.'
  );
}

export type SignalType = string;
export interface EmitSignalParams {
  siteId: string;
  callId?: string | null;
  signalType: SignalType;
  conversionName?: string;
  aov: number;
  clickDate: Date;
  signalDate?: Date;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  fingerprint?: string | null;
  discriminator?: string | null;
}

export async function emitSignal(_params: EmitSignalParams): Promise<never> {
  throwDeleted();
}
