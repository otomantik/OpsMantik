/**
 * Phase 20: Strict Zod schema for sync ingest payload (SignalManifest).
 * Non-compliant requests receive 422 Unprocessable Entity.
 */

import { z } from 'zod';

const MAX_UA_LEN = 512;
const MAX_REFERRER_LEN = 2048;
const MAX_URL_LEN = 4096;

const nonEmptyString = (maxLen: number) =>
  z.string().trim().min(1).max(maxLen);

const ingestMetaSchema = z.record(z.string(), z.unknown()).optional();

/** Base event fields */
const eventBaseSchema = z.object({
  s: nonEmptyString(128),
  sid: z.string().trim().max(256).optional(),
  sm: z.string().trim().max(32).optional(),
  ec: z.string().trim().max(256).optional(),
  ea: z.string().trim().max(256).optional(),
  el: z.string().trim().max(512).optional(),
  ev: z.union([z.number(), z.string(), z.null()]).optional(),
  meta: ingestMetaSchema,
  r: z.string().trim().max(MAX_REFERRER_LEN).optional(),
});

/** Single event: s required, url OR u required. consent_scopes preserved for sync 204/202 path. */
export const SignalManifestSingleSchema = eventBaseSchema.extend({
  url: z.string().trim().max(MAX_URL_LEN).optional(),
  u: z.string().trim().max(MAX_URL_LEN).optional(),
  consent_scopes: z.array(z.string()).optional(),
}).refine(
  (v) => {
    const url = (v.url ?? '').trim();
    const u = (v.u ?? '').trim();
    return url.length > 0 || u.length > 0;
  },
  { message: 'missing_site_or_url', path: ['url'] }
);

/** Batch: { events: [ ... ] } */
export const SignalManifestBatchSchema = z.object({
  events: z.array(SignalManifestSingleSchema).min(1).max(100),
});

/** Union: single or batch */
export const SignalManifestSchema = z.union([
  SignalManifestSingleSchema,
  SignalManifestBatchSchema,
]);

export type SignalManifestSingle = z.infer<typeof SignalManifestSingleSchema>;
export type SignalManifest = z.infer<typeof SignalManifestSchema>;

/** Convert Zod event to ValidIngestPayload shape (url or u, not both) */
export function toValidIngestPayload(
  e: SignalManifestSingle
): import('@/lib/types/ingest').ValidIngestPayload {
  const url = (e.url ?? '').trim();
  const u = (e.u ?? '').trim();
  const hasUrl = url.length > 0;
  const { url: _url, u: _u, ...rest } = e as SignalManifestSingle & { url?: string; u?: string };
  if (hasUrl) {
    return { ...rest, url } as import('@/lib/types/ingest').ValidIngestPayload;
  }
  return { ...rest, u } as import('@/lib/types/ingest').ValidIngestPayload;
}

/**
 * Parse and validate. Returns { ok: true, data } or { ok: false, errors, code }.
 * Use code for 422 response X-OpsMantik-Error-Code header.
 */
export function parseSignalManifest(input: unknown):
  | { ok: true; data: { events: z.infer<typeof SignalManifestSingleSchema>[] } }
  | { ok: false; errors: z.ZodError['issues']; code: string } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: [], code: 'payload_not_object' };
  }
  const rec = input as Record<string, unknown>;
  if (Array.isArray(rec.events)) {
    const batch = SignalManifestBatchSchema.safeParse(input);
    if (batch.success) {
      return { ok: true, data: { events: batch.data.events } };
    }
    const first = batch.error.issues[0];
    const code = (first?.path?.join('.') as string) || 'batch_validation_failed';
    return { ok: false, errors: batch.error.issues, code };
  }

  const single = SignalManifestSingleSchema.safeParse(input);
  if (single.success) {
    return { ok: true, data: { events: [single.data] } };
  }
  const first = single.error.issues[0];
  const code = (first?.path?.join('.') as string) || (first?.message as string) || 'payload_validation_failed';
  return { ok: false, errors: single.error.issues, code: String(code).slice(0, 64) };
}
