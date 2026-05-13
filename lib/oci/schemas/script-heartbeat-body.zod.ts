import { z } from 'zod';

const featureFlagsRecord = z.record(z.string(), z.unknown()).nullable().optional();

/**
 * POST `/api/oci/script-heartbeat` — strict body (fleet may send snake_case or camelCase aliases).
 */
export const ociScriptHeartbeatBodySchema = z
  .object({
    site_id: z.string().min(1).max(128).optional(),
    siteId: z.string().min(1).max(128).optional(),
    script_version: z.string().max(200).optional(),
    scriptVersion: z.string().max(200).optional(),
    script_hash: z.string().max(256).nullable().optional(),
    scriptHash: z.string().max(256).nullable().optional(),
    last_modified: z.string().max(128).nullable().optional(),
    lastModified: z.string().max(128).nullable().optional(),
    feature_flags: featureFlagsRecord,
    featureFlags: featureFlagsRecord,
  })
  .strict()
  .superRefine((v, ctx) => {
    const sid = (v.site_id?.trim() || v.siteId?.trim() || '').trim();
    if (!sid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'siteId or site_id is required',
        path: ['siteId'],
      });
    }
  });

export type OciScriptHeartbeatBody = z.infer<typeof ociScriptHeartbeatBodySchema>;
