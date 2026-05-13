import { z } from 'zod';

/** GET `/api/oci/google-ads-export` — only these query keys are accepted (strict surface). */
export const GOOGLE_ADS_EXPORT_QUERY_KEYS = new Set([
  'siteId',
  'cursor',
  'limit',
  'markAsExported',
  'canaryMode',
  'canaryExpectedQueueId',
  'allowlistIds',
  'allowlist_ids',
  'providerKey',
]);

const MAX_CURSOR = 65536;
const MAX_ALLOWLIST_CHARS = 400_000;

/**
 * String-level validation for export query values (unknown URL keys rejected separately).
 */
export const googleAdsExportQueryStringsSchema = z
  .object({
    siteId: z.string().max(128).optional(),
    cursor: z.string().max(MAX_CURSOR).optional(),
    limit: z.string().max(8).regex(/^\d+$/).optional(),
    markAsExported: z.enum(['true', 'false']).optional(),
    canaryMode: z.string().max(8).optional(),
    canaryExpectedQueueId: z.string().max(128).optional(),
    allowlistIds: z.string().max(MAX_ALLOWLIST_CHARS).optional(),
    allowlist_ids: z.string().max(MAX_ALLOWLIST_CHARS).optional(),
    providerKey: z.string().max(64).regex(/^[a-z0-9_-]+$/i).optional(),
  })
  .strict();

export type GoogleAdsExportQueryStrings = z.infer<typeof googleAdsExportQueryStringsSchema>;

export function collectUnknownExportQueryKeys(searchParams: URLSearchParams): string[] {
  const bad: string[] = [];
  for (const k of new Set(searchParams.keys())) {
    if (!GOOGLE_ADS_EXPORT_QUERY_KEYS.has(k)) bad.push(k);
  }
  return bad.sort();
}

/** Build partial object from URLSearchParams (only known keys with non-empty values). */
export function exportQueryParamsToStrictInput(searchParams: URLSearchParams): Record<string, string> {
  const o: Record<string, string> = {};
  for (const key of GOOGLE_ADS_EXPORT_QUERY_KEYS) {
    const v = searchParams.get(key);
    if (v !== null && v !== '') o[key] = v;
  }
  return o;
}

export function formatZodIssues(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({
    path: i.path.length ? i.path.map(String).join('.') : '(root)',
    message: i.message,
  }));
}
