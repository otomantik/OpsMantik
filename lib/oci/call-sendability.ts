export type OciSendableCallStatus = 'confirmed' | 'qualified' | 'real';

const SENDABLE_CALL_STATUSES = new Set<OciSendableCallStatus>(['confirmed', 'qualified', 'real']);

// Some signal rows are emitted before the call graduates out of "intent".
// Canonical stage rows must stay exportable in that state or panel actions get stuck in DB only.
const SIGNAL_INTENT_SENDABLE_STATUSES = new Set<string>(['intent', 'confirmed', 'qualified', 'real']);
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
 * Outbox → marketing_signals (contacted / offered / junk). Won uses {@link isCallSendableForSealExport}.
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
