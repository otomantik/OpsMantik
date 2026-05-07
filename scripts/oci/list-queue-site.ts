#!/usr/bin/env npx tsx
/** Read-only: list offline_conversion_queue rows for one site. */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

const siteFilterArg = process.argv.find((a) => a.startsWith('--site='))?.slice('--site='.length)?.trim();
if (!siteFilterArg) {
  console.error('Usage: npx tsx scripts/oci/list-queue-site.ts --site=<uuid|public_id|fragment>');
  process.exit(1);
}
const siteFilter: string = siteFilterArg;

async function main() {
  const orFilter = UUID_RE.test(siteFilter)
    ? `id.eq.${siteFilter},public_id.eq.${siteFilter}`
    : `name.ilike.%${siteFilter}%,domain.ilike.%${siteFilter}%,public_id.ilike.%${siteFilter}%`;
  const { data: sites, error: sErr } = await supabase.from('sites').select('id, name, domain').or(orFilter).limit(2);
  if (sErr) throw sErr;
  if (!sites?.length) {
    console.error('Site not found');
    process.exit(1);
  }
  if (sites.length > 1) {
    console.error('Ambiguous site filter');
    process.exit(1);
  }
  const site = sites[0];
  const siteId = site.id as string;

  const { data: rows, error } = await supabase
    .from('offline_conversion_queue')
    .select(
      'id, status, call_id, sale_id, value_cents, currency, gclid, wbraid, gbraid, block_reason, provider_error_code, created_at, updated_at'
    )
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  console.log(`\n${site.name} (${site.domain})`);
  console.log(`site_id: ${siteId}`);
  console.log(`rows: ${(rows ?? []).length}\n`);

  const table = (rows ?? []).map((r: Record<string, unknown>) => ({
    status: r.status,
    value: r.value_cents,
    cur: r.currency,
    block: r.block_reason ?? '',
    call: String(r.call_id ?? '').slice(0, 8),
    queue_id: String(r.id ?? '').slice(0, 8),
    updated: String(r.updated_at ?? '').slice(0, 19),
  }));

  console.table(table);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
