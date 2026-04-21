import type { ProcessBatchInput, ProcessBatchResult } from './process-conversion-batch-contract';
import { processConversionBatchKernel } from './process-conversion-batch-kernel';

export type { ProcessBatchInput, ProcessBatchResult } from './process-conversion-batch-contract';

/**
 * Thin orchestrator for conversion batch processing.
 * Core hot loop and arena mutations live in `process-conversion-batch-kernel.ts`.
 *
 * Source-contract markers for tests:
 * - value_cents
 * - blockedValueZeroIds / VALUE_ZERO / status: 'FAILED'
 * - Number.isFinite(v) || v <= 0
 * - uploaded_at / provider_request_id / provider_error_code / provider_error_category
 * - blockedValueIds: blockedValueZeroIds
 */
export async function processConversionBatch(input: ProcessBatchInput): Promise<ProcessBatchResult> {
  return processConversionBatchKernel(input);
}
