import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';

export type OciSendableCallStatus = 'confirmed' | 'qualified' | 'real';

const SENDABLE_CALL_STATUSES = new Set<OciSendableCallStatus>(['confirmed', 'qualified', 'real']);

// Some signal rows are emitted before the call graduates out of "intent".
// Canonical stage rows must stay exportable in that state or panel actions get stuck in DB only.
/** Call rows may already mirror funnel stage (`contacted` / `offered`) while emitting the same-named signal. */
const SIGNAL_INTENT_SENDABLE_STATUSES = new Set<string>([
  'intent',
  'contacted',
  'offered',
  'confirmed',
  'qualified',
  'real',
]);
const SIGNAL_TYPES_ALLOWING_INTENT_STATUS = new Set<string>([
  'contacted',
  'offered',
]);

export function isCallStatusSendableForOci(status: string | null | undefined): boolean {
  if (!status) return false;
  return SENDABLE_CALL_STATUSES.has(status.trim().toLowerCase() as OciSendableCallStatus);
}

export function isCallStatusSendableForSignal(
  status: string | null | undefined,
  signalType: string
): boolean {
  if (!status) return false;
  const normalized = status.trim().toLowerCase();
  const normalizedSignalType = signalType.trim().toLowerCase();
  if (SIGNAL_TYPES_ALLOWING_INTENT_STATUS.has(normalizedSignalType)) {
    return SIGNAL_INTENT_SENDABLE_STATUSES.has(normalized);
  }
  return SENDABLE_CALL_STATUSES.has(normalized as OciSendableCallStatus);
}

export function isCallSendableForSealExport(
  status: string | null | undefined,
  ociStatus: string | null | undefined
): boolean {
  const st = (status ?? '').trim().toLowerCase();
  // Panel / apply_call_action_v2 persists terminal sale as status=won without war-room seal metadata.
  // enqueueSealConversion still enforces click id + consent + temporal sanity.
  if (st === 'won') {
    return true;
  }
  return isCallStatusSendableForOci(status) && (ociStatus ?? '').trim().toLowerCase() === 'sealed';
}

/**
 * Google Ads offline queue export: sendability is **per journal action**, not one bit per call.
 * Won keeps seal-style rules; contacted/offered/junk use the same intent/signal gates as outbox.
 */
export function isQueueRowSendableForGoogleAdsExport(
  queueAction: string | null | undefined,
  callStatus: string | null | undefined,
  ociStatus: string | null | undefined
): boolean {
  const act = (queueAction ?? '').trim();
  if (act === OPSMANTIK_CONVERSION_NAMES.won) {
    return isCallSendableForSealExport(callStatus, ociStatus);
  }
  if (act === OPSMANTIK_CONVERSION_NAMES.contacted) {
    return isCallStatusSendableForSignal(callStatus, 'contacted');
  }
  if (act === OPSMANTIK_CONVERSION_NAMES.offered) {
    return isCallStatusSendableForSignal(callStatus, 'offered');
  }
  if (act === OPSMANTIK_CONVERSION_NAMES.junk) {
    return isCallSendableForOutboxSignalStage(callStatus, 'junk');
  }
  return isCallSendableForSealExport(callStatus, ociStatus);
}

/**
 * Outbox → journal micro-stages (contacted / offered / junk). Won uses {@link isCallSendableForSealExport}.
 * Junk satırı: çağrı durumu junk olmalı; contacted/offered için intent + mevcut sinyal kuralları.
 */
export function isCallSendableForOutboxSignalStage(
  callStatus: string | null | undefined,
  stage: 'contacted' | 'offered' | 'junk'
): boolean {
  const st = (callStatus ?? '').trim().toLowerCase();
  if (stage === 'junk') {
    return st === 'junk';
  }
  return isCallStatusSendableForSignal(callStatus, stage);
}
