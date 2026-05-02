import type { OptimizationStage } from '@/lib/oci/optimization-contract';
import {
  OPSMANTIK_CONVERSION_NAMES,
  isOciCanonicalStage,
  resolveOciConversionName,
} from './conversion-names';

/** Same object reference as `OPSMANTIK_CONVERSION_NAMES` — façade for legacy imports. */
export const OCI_CONVERSION_SSOT = OPSMANTIK_CONVERSION_NAMES;

export type OciCanonicalStage = OptimizationStage;

export { resolveOciConversionName, isOciCanonicalStage };
