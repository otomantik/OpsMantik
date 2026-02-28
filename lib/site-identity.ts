/**
 * Identity Protocol: public_id and oci_api_key generation for Sites.
 * Used by backfill script; DB trigger handles auto-generation on INSERT.
 */

import { randomBytes } from 'node:crypto';

/**
 * Generate a slug-friendly public_id (e.g., site-a1b2c3d4e5f6).
 * Used when creating sites programmatically if public_id not provided.
 */
export function generatePublicId(): string {
  return 'site-' + randomBytes(6).toString('hex');
}

/**
 * Generate a secure OCI API key (64 hex chars).
 * Used by backfill script; DB trigger auto-generates on INSERT.
 */
export function generateOciApiKey(): string {
  return randomBytes(32).toString('hex');
}
