import { parseWithinTemporalSanityWindow } from '@/lib/utils/temporal-sanity';
import type { PipelineStage } from '@/lib/domain/mizan-mantik/types';

export type OciTimeConfidence =
  | 'observed'
  | 'operator_entered'
  | 'inferred'
  | 'legacy_migrated';

export type OciOccurredAtSource =
  | 'intent'
  | 'qualified'
  | 'proposal'
  | 'sale'
  | 'fallback_confirmed'
  | 'legacy_migrated';

export function getOccurredAtSourceForStage(stage: PipelineStage): OciOccurredAtSource {
  switch (stage) {
    case 'contacted':
      return 'qualified';
    case 'offered':
      return 'proposal';
    case 'won':
      return 'sale';
    case 'junk':
    default:
      return 'legacy_migrated';
  }
}

export function resolveSignalOccurredAt(signalDate: Date, stage: PipelineStage) {
  const occurredAt = signalDate.toISOString();
  return {
    occurredAt,
    sourceTimestamp: occurredAt,
    timeConfidence: 'observed' as const satisfies OciTimeConfidence,
    occurredAtSource: getOccurredAtSourceForStage(stage),
  };
}

export function resolveSealOccurredAt(params: {
  saleOccurredAt?: string | null;
  fallbackConfirmedAt: string;
}) {
  const parsedSaleOccurredAt = parseWithinTemporalSanityWindow(params.saleOccurredAt ?? null);
  if (parsedSaleOccurredAt) {
    const iso = parsedSaleOccurredAt.toISOString();
    return {
      occurredAt: iso,
      sourceTimestamp: iso,
      timeConfidence: 'operator_entered' as const satisfies OciTimeConfidence,
      occurredAtSource: 'sale' as const satisfies OciOccurredAtSource,
    };
  }

  const confirmed = new Date(params.fallbackConfirmedAt).toISOString();
  return {
    occurredAt: confirmed,
    sourceTimestamp: confirmed,
    timeConfidence: 'inferred' as const satisfies OciTimeConfidence,
    occurredAtSource: 'fallback_confirmed' as const satisfies OciOccurredAtSource,
  };
}

export function pickCanonicalOccurredAt(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const parsed = parseWithinTemporalSanityWindow(candidate ?? null);
    if (parsed) return parsed.toISOString();
  }
  return null;
}
