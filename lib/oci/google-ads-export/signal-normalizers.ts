/**
 * Signal stage / channel normalizers for the Google Ads export route.
 * Extracted from app/api/oci/google-ads-export/route.ts during Phase 4
 * god-object split. No behaviour change.
 */

import type { OptimizationStage } from '@/lib/oci/optimization-contract';

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
