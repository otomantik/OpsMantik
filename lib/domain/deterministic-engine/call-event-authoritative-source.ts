/**
 * PR4-D — Single authoritative paid/organic derivation for call-event ingest (calls row + truth + canonical).
 * Must match legacy ternary semantics exactly.
 */

export type CallEventSanitizedIds = {
  sanitizedGclid: string | null;
  sanitizedWbraid: string | null;
  sanitizedGbraid: string | null;
  sanitizedClickId: string | null;
};

/**
 * Authoritative call-event source_type: paid if any sanitized click id is present, else organic.
 * Equivalent to: (gclid || wbraid || gbraid || clickId) ? 'paid' : 'organic'
 */
export function deriveCallEventAuthoritativePaidOrganic(ids: CallEventSanitizedIds): 'paid' | 'organic' {
  const { sanitizedGclid, sanitizedWbraid, sanitizedGbraid, sanitizedClickId } = ids;
  return sanitizedGclid || sanitizedWbraid || sanitizedGbraid || sanitizedClickId ? 'paid' : 'organic';
}
