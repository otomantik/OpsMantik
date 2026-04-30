type CanonicalIntentKeyInput = {
  callId?: string | null;
  siteId: string;
  matchedSessionId?: string | null;
  intentAction?: string | null;
  occurredAt?: string | Date | null;
};

function normalizeMinuteBucket(value: string | Date | null | undefined): string {
  const dt = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (!Number.isFinite(dt.getTime())) return new Date().toISOString().slice(0, 16);
  return dt.toISOString().slice(0, 16);
}

export function buildCanonicalIntentKey(input: CanonicalIntentKeyInput): string {
  const sessionId = (input.matchedSessionId || 'none').trim() || 'none';
  const intentAction = (input.intentAction || 'unknown').trim().toLowerCase() || 'unknown';
  const minuteBucket = normalizeMinuteBucket(input.occurredAt);
  return `fallback:${input.siteId}:${sessionId}:${intentAction}:${minuteBucket}`;
}

