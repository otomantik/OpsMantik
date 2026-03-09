function normalizeRedisKeyPart(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueRedisKeyParts(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(normalizeRedisKeyPart).filter((value): value is string => Boolean(value)))];
}

export function getCanonicalPvRedisSiteKey(siteId: string): string {
  const normalized = normalizeRedisKeyPart(siteId);
  if (!normalized) {
    throw new Error('PV redis site key requires a non-empty site id');
  }
  return normalized;
}

export function getPvQueueKey(siteId: string): string {
  return `pv:queue:${getCanonicalPvRedisSiteKey(siteId)}`;
}

export function getPvProcessingKey(siteId: string): string {
  return `pv:processing:${getCanonicalPvRedisSiteKey(siteId)}`;
}

export function getPvDataKey(pvId: string): string {
  return `pv:data:${pvId}`;
}

export function getPvQueueKeysForExport(siteId: string, publicId?: string | null): string[] {
  return uniqueRedisKeyParts([siteId, publicId]).map((key) => `pv:queue:${key}`);
}

export function getPvProcessingKeysForCleanup(siteId: string, publicId?: string | null): string[] {
  return uniqueRedisKeyParts([siteId, publicId]).map((key) => `pv:processing:${key}`);
}

export function getPvProcessingKeysForRecovery(siteId: string, publicId?: string | null): string[] {
  return getPvProcessingKeysForCleanup(siteId, publicId);
}
