/**
 * Deterministic SHA-256 digests for inference inputs (no raw PII; structural fields only).
 */

import { createHash } from 'node:crypto';

/** Stable JSON + sha256 hex for replay correlation. */
export function stableInferenceDigest(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = obj[k];
  const canonical = JSON.stringify(sorted);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
