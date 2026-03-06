import { adminClient } from '@/lib/supabase/admin';
import { resolveStrictTestSiteId } from '@/tests/helpers/strict-ingest-helpers';

export function currentMonthStartIsoDate(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export async function resolveTwoDistinctSites(): Promise<{ siteA: string; siteB: string } | null> {
  const siteA = await resolveStrictTestSiteId();
  if (!siteA) return null;

  const { data: siteBRow, error } = await adminClient
    .from('sites')
    .select('id')
    .neq('id', siteA)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !siteBRow?.id) return null;
  return { siteA, siteB: siteBRow.id };
}
