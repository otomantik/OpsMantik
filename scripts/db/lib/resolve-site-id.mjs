/**
 * Resolve `sites.id` from UUID or fuzzy name/domain match.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} [query]
 * @returns {Promise<string | null>}
 */
export async function resolveSiteId(supabase, query) {
  const q = (query ?? '').trim();
  if (!q) return null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(q)) {
    const { data } = await supabase.from('sites').select('id').eq('id', q).maybeSingle();
    return data?.id ?? null;
  }
  const { data: rows } = await supabase
    .from('sites')
    .select('id')
    .or(`name.ilike.%${q}%,domain.ilike.%${q}%`)
    .limit(1);
  return rows?.[0]?.id ?? null;
}
