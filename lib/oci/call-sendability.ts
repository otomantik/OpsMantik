export type OciSendableCallStatus = 'confirmed' | 'qualified' | 'real';

const SENDABLE_CALL_STATUSES = new Set<OciSendableCallStatus>(['confirmed', 'qualified', 'real']);

export function isCallStatusSendableForOci(status: string | null | undefined): boolean {
  if (!status) return false;
  return SENDABLE_CALL_STATUSES.has(status.trim().toLowerCase() as OciSendableCallStatus);
}

export function isCallSendableForSealExport(
  status: string | null | undefined,
  ociStatus: string | null | undefined
): boolean {
  return isCallStatusSendableForOci(status) && (ociStatus ?? '').trim().toLowerCase() === 'sealed';
}
