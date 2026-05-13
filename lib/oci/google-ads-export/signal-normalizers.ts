/**
 * Signal stage / channel normalizers for the Google Ads export route.
 * Extracted from app/api/oci/google-ads-export/route.ts during Phase 4
 * god-object split. No behaviour change.
 */

import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';
import type { OptimizationStage } from '@/lib/oci/optimization-contract';
import type { SingleConversionGear } from '@/lib/oci/single-conversion-highest-only';

export function resolveSignalStage(
  optimizationStage: string | null | undefined,
  signalType: string
): OptimizationStage | null {
  const normalizedStage = (optimizationStage || '').trim().toLowerCase();
  if (
    normalizedStage === 'junk' ||
    normalizedStage === 'contacted' ||
    normalizedStage === 'offered' ||
    normalizedStage === 'won'
  ) {
    return normalizedStage as OptimizationStage;
  }

  switch ((signalType || '').trim()) {
    case 'contacted':
    case 'offered':
    case 'won':
      return signalType.trim() as OptimizationStage;
    default:
      return null;
  }
}

export function normalizeSignalChannel(
  intentAction: string | null | undefined
): 'phone' | 'whatsapp' | 'form' | null {
  switch ((intentAction || '').trim().toLowerCase()) {
    case 'phone':
    case 'whatsapp':
    case 'form':
      return (intentAction || '').trim().toLowerCase() as 'phone' | 'whatsapp' | 'form';
    default:
      return null;
  }
}

/**
 * Maps queue RPC snapshot rows to {@link SingleConversionGear} for ranking / dedupe.
 * Mirrors `gearFromQueueExportRow` invariants in `export-build-queue.ts` (queue-only path).
 */
export function resolveQueueExportGear(row: {
  optimization_stage?: string | null;
  action?: string | null;
}): SingleConversionGear {
  const fromStage = resolveSignalStage(row.optimization_stage, '');
  if (fromStage) return fromStage;

  const action = (row.action ?? '').trim();
  if (action === OPSMANTIK_CONVERSION_NAMES.junk) return 'junk';
  if (action === OPSMANTIK_CONVERSION_NAMES.contacted) return 'contacted';
  if (action === OPSMANTIK_CONVERSION_NAMES.offered) return 'offered';
  return 'won';
}
