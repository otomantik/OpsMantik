/**
 * Parse Postgres RPC timestamps in the browser (qualification queue range filters).
 */
export function parseRpcTimestampMs(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const raw = String(value).trim();
  if (!raw) return Number.NaN;

  // Postgres RPC may return "YYYY-MM-DD HH:mm:ss.ssssss+00".
  const normalized = raw
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace('Z+00:00', '+00:00');

  const parsed = new Date(normalized).getTime();
  if (Number.isFinite(parsed)) return parsed;
  return new Date(raw).getTime();
}
