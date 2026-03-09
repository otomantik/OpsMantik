/**
 * Singularity: Entropy score from fingerprint (IP/UA failure rate).
 * "Flag but Process" — high entropy sets uncertainty_bit for internal analytics.
 */

import { adminClient } from '@/lib/supabase/admin';

const ENTROPY_UNCERTAINTY_THRESHOLD = 0.5;

export interface EntropyResult {
  score: number;
  uncertaintyBit: boolean;
}

/**
 * Returns entropy score 0–1 and uncertainty bit for a fingerprint.
 * If fingerprint is null or no data: { score: 0, uncertaintyBit: false }.
 */
export async function getEntropyScore(fingerprint: string | null): Promise<EntropyResult> {
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.trim() === '') {
    return { score: 0, uncertaintyBit: false };
  }

  const { data, error } = await adminClient
    .from('signal_entropy_by_fingerprint')
    .select('failure_count, total_count')
    .eq('fingerprint', fingerprint.trim())
    .maybeSingle();

  if (error || !data) {
    return { score: 0, uncertaintyBit: false };
  }

  const total = Number((data as { total_count?: number }).total_count) ?? 0;
  const failure = Number((data as { failure_count?: number }).failure_count) ?? 0;

  if (total <= 0) {
    return { score: 0, uncertaintyBit: false };
  }

  const score = Math.min(1, Math.max(0, failure / total));
  const uncertaintyBit = score > ENTROPY_UNCERTAINTY_THRESHOLD;

  return { score, uncertaintyBit };
}

/**
 * Build a fingerprint string from IP and User-Agent (e.g. for ingest APIs).
 * Returns stable key for lookup; use same format when recording outcomes.
 */
/** @deprecated Unused; fingerprint built elsewhere. Kept for API. */
export function buildFingerprint(ip: string | null, userAgent: string | null): string {
  const a = (ip ?? '').trim();
  const b = (userAgent ?? '').trim();
  if (!a && !b) return '';
  const payload = `${a}|${b}`;
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(payload, 'utf8').toString('base64url');
  }
  return payload;
}
