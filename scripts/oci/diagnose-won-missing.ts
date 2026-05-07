#!/usr/bin/env npx tsx
/**
 * List won/sealed calls that fail queue-health WON_MISSING_PIPELINE for a site, plus queue rows for those calls.
 * Read-only. Uses .env.local service role.
 *
 * Usage: npx tsx scripts/oci/diagnose-won-missing.ts --site=koc
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMissingWonPipelineCallIds } from '../../lib/oci/won-missing-pipeline-site';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

function parseSite(argv: string[]): string | null {
  const raw = argv.find((a) => a.startsWith('--site='))?.slice('--site='.length);
  return raw?.trim() || null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveSiteId(filter: string) {
  const orFilter = UUID_RE.test(filter.trim())
    ? `id.eq.${filter},public_id.eq.${filter}`
    : `name.ilike.%${filter}%,domain.ilike.%${filter}%,public_id.ilike.%${filter}%`;
  const { data, error } = await supabase.from('sites').select('id, name, domain, oci_sync_method').or(orFilter).limit(2);
  if (error) throw error;
  if (!data?.length) {
    console.error('No site matched:', filter);
    process.exit(1);
  }
  if (data.length > 1) {
    console.error('Ambiguous --site= filter');
    process.exit(1);
  }
  return data[0];
}

async function main() {
  const siteFilter = parseSite(process.argv.slice(2));
  if (!siteFilter) {
    console.error('Usage: npx tsx scripts/oci/diagnose-won-missing.ts --site=<uuid|public_id|name fragment>');
    process.exit(1);
  }

  const site = await resolveSiteId(siteFilter);
  const siteId = site.id as string;

  const missingIds = await listMissingWonPipelineCallIds(supabase, siteId);

  if (missingIds.length === 0) {
    console.log('\n=== WON_MISSING_PIPELINE diagnosis ===\n');
    console.log(`site: ${site.name} (${site.domain})`);
    console.log(`site_id: ${siteId}`);
    console.log('missing_count: 0');
    console.log('\nNo missing calls — queue health WON_MISSING_PIPELINE should be clear for this site.');
    return;
  }

  const { data: callRows, error: callErr } = await supabase
    .from('calls')
    .select('id, status, oci_status, confirmed_at')
    .eq('site_id', siteId)
    .in('id', missingIds);

  if (callErr) throw callErr;

  const queueByCall: Record<string, Array<{ id: string; status: string; sale_id: string | null }>> = {};

  {
    const { data: qrows, error: qerr } = await supabase
      .from('offline_conversion_queue')
      .select('id, call_id, sale_id, status')
      .eq('site_id', siteId)
      .in('call_id', missingIds);
    if (qerr) throw qerr;
    for (const r of qrows || []) {
      const cid = (r as { call_id?: string }).call_id;
      if (!cid) continue;
      if (!queueByCall[cid]) queueByCall[cid] = [];
      queueByCall[cid].push({
        id: (r as { id: string }).id,
        status: String((r as { status?: string }).status),
        sale_id: (r as { sale_id?: string | null }).sale_id ?? null,
      });
    }
  }

  console.log('\n=== WON_MISSING_PIPELINE diagnosis ===\n');
  console.log(`site: ${site.name} (${site.domain})`);
  console.log(`site_id: ${siteId}`);
  console.log(`oci_sync_method: ${(site as { oci_sync_method?: string }).oci_sync_method ?? '?'}`);
  console.log(`missing_count: ${missingIds.length}\n`);

  console.log(
    'Note: Queue rows in FAILED/DLQ/VOID do not “protect” per contract; sweep also skips if any row exists for call_id.\n'
  );

  for (const id of missingIds) {
    const c = (callRows || []).find((x) => (x as { id: string }).id === id) as
      | { id: string; status?: string; oci_status?: string; confirmed_at?: string }
      | undefined;
    const q = queueByCall[id] || [];
    console.log(`call_id: ${id}`);
    console.log(`  call: status=${c?.status ?? '?'} oci_status=${c?.oci_status ?? '?'} confirmed_at=${c?.confirmed_at ?? '?'}`);
    if (q.length === 0) {
      console.log('  queue: (no rows with this call_id)');
      console.log('  action: run cron sweep for recent window, or enqueueSealConversion path; if older than 7d sweep lookback, extend lookback or fix manually.');
    } else {
      console.log(`  queue rows (${q.length}):`);
      for (const row of q) {
        console.log(`    - ${row.id} status=${row.status} sale_id=${row.sale_id ?? 'null'}`);
      }
      console.log(
        '  action: transition terminal/bad states to QUEUED or RETRY via append_script_transition_batch / OCI control (not blind delete).'
      );
    }
    console.log('');
  }

  console.log('Align script mode: oci_sync_method=script and Google script schedule unchanged after queue is GREEN.\n');
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
