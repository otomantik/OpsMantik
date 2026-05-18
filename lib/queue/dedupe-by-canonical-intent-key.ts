import type { HunterIntentLite } from '@/lib/types/hunter';
import { parseRpcTimestampMs } from '@/lib/queue/parse-rpc-timestamp-ms';

/**
 * Collapse duplicate lite rows by canonical/dedupe key, keeping the newest created_at.
 */
export function dedupeByIdOrCanonicalKey(rows: HunterIntentLite[]): HunterIntentLite[] {
  const byPrimary = new Map<string, HunterIntentLite>();
  for (const row of rows) {
    const key =
      (typeof row.canonical_intent_key === 'string' && row.canonical_intent_key.trim()) ||
      (typeof row.dedupe_key === 'string' && row.dedupe_key.trim()) ||
      (typeof row.id === 'string' && row.id.trim()) ||
      '';
    if (!key) continue;
    const prev = byPrimary.get(key);
    if (!prev) {
      byPrimary.set(key, row);
      continue;
    }
    const prevTs = parseRpcTimestampMs(prev.created_at);
    const curTs = parseRpcTimestampMs(row.created_at);
    if (!Number.isFinite(prevTs) || (Number.isFinite(curTs) && curTs >= prevTs)) {
      byPrimary.set(key, row);
    }
  }
  return Array.from(byPrimary.values());
}
