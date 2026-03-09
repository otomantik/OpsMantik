/**
 * Sanitize error messages for client responses to prevent schema/DB detail leakage.
 * In production, returns a generic message; full error is logged by caller.
 */

export function sanitizeErrorForClient(error: unknown): string {
  if (process.env.NODE_ENV !== 'production') {
    return error instanceof Error ? error.message : String(error ?? 'Unknown error');
  }
  return 'Something went wrong';
}
