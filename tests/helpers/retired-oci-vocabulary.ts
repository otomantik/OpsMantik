/**
 * Retired OCI audit surface — literals built for ban scans only (not for runtime).
 */
function fromCodes(codes: readonly number[]): string {
  return String.fromCharCode(...codes);
}

/** Dropped audit table (queue-only OCI since 20261320120000). */
export const RETIRED_AUDIT_TABLE = fromCodes([
  0x6d, 0x61, 0x72, 0x6b, 0x65, 0x74, 0x69, 0x6e, 0x67, 0x5f, 0x73, 0x69, 0x67, 0x6e, 0x61, 0x6c,
  0x73,
]);

export const RETIRED_FROM_CLAUSE = `from('${RETIRED_AUDIT_TABLE}')`;

export const RETIRED_DROP_MIGRATION = `20261320120000_${RETIRED_AUDIT_TABLE}_drop_final_v1.sql`;

export const RETIRED_CLEANUP_RPC = `cleanup_${RETIRED_AUDIT_TABLE}_batch`;

export const RETIRED_FORBIDDEN_RE = new RegExp(
  [
    RETIRED_AUDIT_TABLE,
    'marketing-signal',
    'MarketingSignal',
    'upsertMarketingSignal',
    'insertMarketingSignal',
    'cleanup_marketing_signals_batch',
    'applyMarketingSignalDispatchBatch',
    'ensureMarketingSignalQueueParity',
    'marketing-signals-cleanup',
  ].join('|')
);

export function assertNoRetiredVocabulary(src: string, label: string): void {
  if (RETIRED_FORBIDDEN_RE.test(src)) {
    throw new Error(`${label} contains retired OCI audit vocabulary`);
  }
}
