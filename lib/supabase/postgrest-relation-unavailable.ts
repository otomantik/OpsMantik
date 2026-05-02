/**
 * PostgREST / Supabase JS often surfaces missing relations as schema-cache errors
 * (no stable SQLSTATE). When optional audit tables are absent, core paths must not throw.
 */

export const PG_UNDEFINED_TABLE = '42P01';

/**
 * @param relationName — substring match on error message (e.g. `truth_canonical_ledger`).
 *   When provided, message-heuristic matches require this substring to reduce false positives.
 */
export function isPostgrestRelationUnavailableError(
  error: { code?: string; message?: string } | null | undefined,
  relationName?: string | null
): boolean {
  if (!error) return false;
  const raw = String(error.message ?? '');
  const m = raw.toLowerCase();
  const rel = (relationName ?? '').trim().toLowerCase();

  if (error.code === PG_UNDEFINED_TABLE) {
    if (!rel) return true;
    return m.includes(rel);
  }

  const looksLikeMissingRelation =
    (m.includes('schema cache') && m.includes('table')) ||
    (m.includes('could not find') && m.includes('table')) ||
    (m.includes('relation') && m.includes('does not exist'));

  if (!looksLikeMissingRelation) return false;
  if (!rel) return false;
  return m.includes(rel) || m.includes(`'public.${rel}'`) || m.includes(`"${rel}"`);
}
