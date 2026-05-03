/**
 * Single visible row per logical intent: prefer canonical / dedupe keys, then session, then call id.
 * Matches qualification queue (`use-queue-controller`) so mobile panel and hunter deck stay aligned.
 */
export type IntentDedupeRow = {
  id: string;
  matched_session_id?: string | null;
  canonical_intent_key?: string | null;
  dedupe_key?: string | null;
};

export function intentDedupeKey(row: IntentDedupeRow): string {
  return (
    (typeof row.canonical_intent_key === 'string' && row.canonical_intent_key.trim()) ||
    (typeof row.dedupe_key === 'string' && row.dedupe_key.trim()) ||
    (typeof row.matched_session_id === 'string' && row.matched_session_id.trim()
      ? `sid:${row.matched_session_id.trim()}`
      : `call:${row.id}`)
  );
}

export function dedupeLatestByIntentKey<T extends IntentDedupeRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const sessionKey = intentDedupeKey(row);
    if (seen.has(sessionKey)) continue;
    seen.add(sessionKey);
    out.push(row);
  }
  return out;
}
