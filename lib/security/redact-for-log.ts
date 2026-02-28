/**
 * Redact sensitive identifiers for production logs.
 * Never expose raw UUIDs or PII in log output.
 */

import { createHash } from 'crypto';

/**
 * Returns a short SHA-256 hash prefix safe for logging.
 * Irreversible; same input always yields same output for correlation.
 */
export function hashForLog(value: string): string {
  if (!value || value.trim().length === 0) return '(empty)';
  const hash = createHash('sha256').update(value.trim()).digest('hex');
  return hash.slice(0, 12);
}
