import type { OptimizationStage } from '@/lib/oci/optimization-contract';
import {
  OPSMANTIK_CONVERSION_NAMES,
  isOciCanonicalStage,
  resolveOciConversionName,
} from '@/lib/oci/conversion-names';

export const OCI_CONVERSION_SSOT = OPSMANTIK_CONVERSION_NAMES;
export type OciCanonicalStage = OptimizationStage;
export { resolveOciConversionName, isOciCanonicalStage };
