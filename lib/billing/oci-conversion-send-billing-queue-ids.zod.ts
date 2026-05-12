import { z } from 'zod';

/** Lowercase UUID v4 (queue row id without `seal_` prefix). */
const queueUuidSchema = z.string().uuid();

/** Max rows per export claim batch (align with OCI export caps). */
export const OCI_CONVERSION_SEND_BILLING_MAX_IDS = 5000;

/**
 * Strict input for `increment_oci_conversion_sends_v1`: exact set of queue UUIDs
 * the export route will claim in the same request (dispatch SSOT).
 */
export const ociConversionSendBillingQueueIdsSchema = z
  .array(queueUuidSchema)
  .min(1)
  .max(OCI_CONVERSION_SEND_BILLING_MAX_IDS)
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < arr.length; i += 1) {
      const id = arr[i]!;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate queue_id at index ${i}`,
          path: [i],
        });
        return;
      }
      seen.add(id);
    }
  });

export type OciConversionSendBillingQueueIds = z.infer<typeof ociConversionSendBillingQueueIdsSchema>;

export function parseOciConversionSendBillingQueueIds(raw: string[]): OciConversionSendBillingQueueIds {
  return ociConversionSendBillingQueueIdsSchema.parse(raw);
}
