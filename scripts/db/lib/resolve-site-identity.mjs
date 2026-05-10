/**
 * PR-9H.5B.0A — Resolve operator-provided site identifier to canonical `sites.id` + `sites.public_id`.
 * Accepts either internal UUID (`sites.id`) or `sites.public_id` (e.g. Google Ads Script Properties).
 *
 * Never pass raw operator input directly to `offline_conversion_queue.site_id` — always resolve first.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} adminClient — service-role Supabase client
 * @param {string | null | undefined} input — `TARGET_SITE_ID` / `OPSMANTIK_SITE_ID` value
 * @returns {Promise<
 *   | { input: string; found: true; siteUuid: string; publicId: string | null }
 *   | { input: string; found: false }
 * >}
 */
export async function resolveSiteIdentity(adminClient, input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return { input: '', found: false };
  }

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** @type {Map<string, { id: string; public_id: string | null }>} */
  const merged = new Map();

  const { data: byPublic, error: errPublic } = await adminClient
    .from('sites')
    .select('id, public_id')
    .eq('public_id', raw);

  if (errPublic) {
    throw new Error(`resolveSiteIdentity public_id query failed: ${errPublic.message}`);
  }
  for (const row of byPublic || []) {
    if (row?.id) merged.set(row.id, row);
  }

  if (uuidRe.test(raw)) {
    const { data: byId, error: errId } = await adminClient
      .from('sites')
      .select('id, public_id')
      .eq('id', raw);

    if (errId) {
      throw new Error(`resolveSiteIdentity id query failed: ${errId.message}`);
    }
    for (const row of byId || []) {
      if (row?.id) merged.set(row.id, row);
    }
  }

  const rows = [...merged.values()];
  if (rows.length === 0) {
    return { input: raw, found: false };
  }
  if (rows.length > 1) {
    throw new Error(
      `SITE_IDENTITY_AMBIGUOUS: multiple sites matched input="${raw}". Refine identifier.`
    );
  }

  const only = rows[0];
  return {
    input: raw,
    found: true,
    siteUuid: only.id,
    publicId: only.public_id ?? null,
  };
}

/** User-facing hint when `found: false` */
export const SITE_NOT_FOUND_HINT =
  'Site not found: offline_conversion_queue.site_id stores sites.id (internal UUID). ' +
  'Script Properties often use sites.public_id (32-char hex). Resolve via sites table first — see docs/runbooks/OCI_HARDENING_OPERATIONS.md';
