/**
 * PR4-B — Pure bucket comparison for shadow parity metrics.
 */

import type { PaidSurfaceBucket } from '@/lib/domain/deterministic-engine/contract';

export function comparePaidSurfaceBuckets(
  primary: PaidSurfaceBucket,
  shadow: PaidSurfaceBucket
): 'match' | 'mismatch' {
  return primary === shadow ? 'match' : 'mismatch';
}
