/**
 * PR4-C — Map authoritative call-event source_type string to PaidSurfaceBucket (identity).
 */

import type { PaidSurfaceBucket } from '@/lib/domain/deterministic-engine/contract';

export function paidSurfaceFromCallEventSourceType(sourceType: 'paid' | 'organic'): PaidSurfaceBucket {
  return sourceType;
}
