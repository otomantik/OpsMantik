import { createHash } from 'crypto';

export function normalizeForHash(value: string | null | undefined): string {
  if (value == null) return 'null';
  if (value === '') return 'empty';
  return value;
}

export function buildOciEvidenceHash(params: {
  siteId: string;
  callId: string | null | undefined;
  stage: string;
  reason: string;
  matchedSessionId?: string | null | undefined;
  primaryClickIdPresent: boolean;
}): string {
  const raw = [
    params.siteId,
    normalizeForHash(params.callId),
    params.stage,
    params.reason,
    normalizeForHash(params.matchedSessionId),
    params.primaryClickIdPresent ? 'click_present' : 'click_missing',
  ].join(':');
  return createHash('sha256').update(raw).digest('hex');
}
