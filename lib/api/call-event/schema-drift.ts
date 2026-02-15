/**
 * Call-event DB schema drift helpers.
 *
 * Purpose:
 * - Production DB migrations may lag behind app deploys.
 * - Supabase/PostgREST can return "missing column" errors (42703 / PGRST204).
 * - For call-event ingestion, we prefer storing a reduced row over returning 500.
 *
 * This module extracts missing column names from Supabase/PostgREST errors so callers
 * can retry inserts with unknown columns stripped.
 */

export type SupabaseLikeError = { code?: string; message?: string; details?: string; hint?: string } | null;

/**
 * Attempt to extract the missing column name from a Supabase/PostgREST error.
 * Returns null when error is not a missing/undefined column.
 */
export function extractMissingColumnName(err: unknown): string | null {
  const e = err as SupabaseLikeError;
  const code = (e?.code || '').toString();
  const msg = (e?.message || '').toString();
  const details = (e?.details || '').toString();
  const hay = `${msg}\n${details}`.toLowerCase();

  // Common signals:
  // - Postgres undefined_column: 42703
  // - PostgREST schema cache: PGRST204
  if (code !== '42703' && code !== 'PGRST204') {
    if (!hay.includes('does not exist') && !hay.includes('could not find')) return null;
  }

  // Examples:
  // - column "click_id" of relation "calls" does not exist
  // - Could not find the 'click_id' column of 'calls' in the schema cache
  const m1 = /column\s+"([^"]+)"/i.exec(msg) || /column\s+'([^']+)'/i.exec(msg);
  if (m1?.[1]) return m1[1];

  const m2 = /could not find the '([^']+)' column/i.exec(msg) || /could not find the \"([^\"]+)\" column/i.exec(msg);
  if (m2?.[1]) return m2[1];

  // Fallback: try details too
  const m3 = /column\s+"([^"]+)"/i.exec(details) || /column\s+'([^']+)'/i.exec(details);
  if (m3?.[1]) return m3[1];

  return null;
}

/**
 * Returns a shallow copy of payload without the given column (if present).
 * Never removes required `site_id` because calls rows must remain tenant-scoped.
 */
export function stripColumnFromInsertPayload(
  payload: Record<string, unknown>,
  column: string
): { next: Record<string, unknown>; stripped: boolean } {
  if (!column) return { next: payload, stripped: false };
  if (column === 'site_id') return { next: payload, stripped: false };
  if (!Object.prototype.hasOwnProperty.call(payload, column)) return { next: payload, stripped: false };
  const { [column]: _removed, ...rest } = payload;
  return { next: rest, stripped: true };
}

