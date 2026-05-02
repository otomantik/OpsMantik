import { z } from 'zod/v3';
import { isOciCanonicalStage } from '@/lib/domain/mizan-mantik/conversion-names';
import { hashNormalizedEmail, hashNormalizedPhoneE164 } from './crypto';

/**
 * Production-hardened OCI Payload Schema.
 * Uses robust regex and basic primitives to ensure compatibility with 
 * the project's specific Zod v4 build while enforcing strict data contracts.
 */
export const OciPayloadSchema = z.object({
  /** Click ID: GCLID, GBRAID, or WBRAID (min 10 chars) */
  click_id: z.string().regex(/^.{10,}$/, 'Click ID must be at least 10 characters'),
  
  /** The conversion value (monetary) */
  conversion_value: z.number().refine(v => v >= 0, 'Value must be 0 or greater'),
  
  /** ISO-4217 Currency Code (3 uppercase letters) */
  currency: z.string().regex(/^[A-Z]{3}$/, 'Currency must be 3 uppercase letters'),
  
  /** Event time: normalize to UTC `Z` for Google OCI (accepts Postgres offsets). */
  conversion_time: z
    .string()
    .min(1)
    .refine(
      (s) => /\d{4}-\d{2}-\d{2}T/.test(s.trim()) && !Number.isNaN(Date.parse(s.trim())),
      'Must be a valid ISO 8601 datetime'
    )
    .transform((s) => new Date(s.trim()).toISOString()),
  
  /** Site identifier (UUID format) */
  site_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Site ID must be a valid UUID'),
  
  /** Pipeline stage */
  stage: z.enum(['contacted', 'offered', 'won', 'junk']),
  
  /** Optional braids */
  gbraid: z.string().optional().nullable(),
  wbraid: z.string().optional().nullable(),
  
  /** Optional metadata */
  metadata: z.record(z.any()).optional(),
});

export type OciPayload = z.infer<typeof OciPayloadSchema>;

export function validateOciPayload(data: unknown): OciPayload {
  return OciPayloadSchema.parse(data);
}

export function safeValidateOciPayload(data: unknown) {
  return OciPayloadSchema.safeParse(data);
}

/**
 * Postgres / panel timestamps are often offset-form ISO (`+00:00`) while {@link OciPayloadSchema}
 * requires UTC `...Z`. Parse and normalize to `Date.toISOString()`.
 */
export function normalizeOciConversionTimeUtcZ(input: string | null | undefined): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function validateCanonicalStage(stage: string): boolean {
  return isOciCanonicalStage(stage);
}

export function normalizeAndHashPii(input: { email?: string | null; phone?: string | null }) {
  return {
    emailSha256: hashNormalizedEmail(input.email),
    phone: hashNormalizedPhoneE164(input.phone),
  };
}
