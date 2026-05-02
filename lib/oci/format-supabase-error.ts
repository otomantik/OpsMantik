/**
 * Supabase/PostgREST errors are often plain objects ({ message, code, details }).
 * Use this when throwing or logging so we never surface "[object Object]".
 */
export function formatSupabaseClientError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code]
      .filter((x) => typeof x === 'string' && x.length > 0) as string[];
    if (parts.length > 0) return parts.join(' | ');
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function supabaseErrorToError(context: string, err: unknown): Error {
  const msg = formatSupabaseClientError(err);
  const e = new Error(`${context}: ${msg}`);
  (e as Error & { cause?: unknown }).cause = err;
  return e;
}

/** Missing relation / PostgREST schema cache — typical when OCI tables were never migrated to remote. */
export function isMissingOciRelationError(err: unknown): boolean {
  const s = formatSupabaseClientError(err).toLowerCase();
  const code = err && typeof err === 'object' ? (err as { code?: string }).code : '';
  if (code === '42P01') return true;
  if (s.includes('schema cache') || s.includes('could not find the table')) return true;
  // PG undefined_table / undefined_object — not "column ... does not exist"
  if (s.includes('relation') && s.includes('does not exist')) return true;
  if (s.includes('table') && s.includes('does not exist') && !s.includes('column')) return true;
  return false;
}
