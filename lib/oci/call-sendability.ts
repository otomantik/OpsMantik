export type OciSendableCallStatus = 'confirmed' | 'qualified' | 'real';

const SENDABLE_CALL_STATUSES = new Set<OciSendableCallStatus>(['confirmed', 'qualified', 'real']);

// V2 (INTENT_CAPTURED / İlk Temas) signals fire at the moment of first contact, before a call
// is confirmed. 'intent' is a valid and expected call status for V2 exports.
const SIGNAL_V2_SENDABLE_STATUSES = new Set<string>(['intent', 'confirmed', 'qualified', 'real']);

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
  if (signalType === 'INTENT_CAPTURED') {
    return SIGNAL_V2_SENDABLE_STATUSES.has(normalized);
  }
  return SENDABLE_CALL_STATUSES.has(normalized as OciSendableCallStatus);
}

export function isCallSendableForSealExport(
  status: string | null | undefined,
  ociStatus: string | null | undefined
): boolean {
  return isCallStatusSendableForOci(status) && (ociStatus ?? '').trim().toLowerCase() === 'sealed';
}
