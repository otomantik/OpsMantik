#!/usr/bin/env node
/**
 * DLQ / failed queue autopsy: group offline_conversion_queue rows by provider_error_code.
 * Read-only. Uses service role from .env.local.
 *
 * Usage: node scripts/oci/dlq-autopsy-report.mjs [--json] [--site=<uuid|public_id|name fragment>]
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

function parseArgs(argv) {
  let json = false;
  let siteFilter = null;
  for (const a of argv) {
    if (a === '--json') json = true;
    if (a.startsWith('--site=')) siteFilter = a.slice('--site='.length);
  }
  return { json, siteFilter };
}

async function resolveSiteId(filter) {
  if (!filter) return null;
  const { data, error } = await supabase
    .from('sites')
    .select('id')
    .or(`id.eq.${filter},public_id.eq.${filter},name.ilike.%${filter}%,domain.ilike.%${filter}%`)
    .limit(2);
  if (error) throw error;
  if (!data?.length) {
    console.error('No site matched:', filter);
    process.exit(1);
  }
  if (data.length > 1) {
    console.error('Ambiguous site filter; narrow --site=');
    process.exit(1);
  }
  return data[0].id;
}

async function run() {
  const { json, siteFilter } = parseArgs(process.argv.slice(2));
  const siteId = await resolveSiteId(siteFilter);

  let q = supabase
    .from('offline_conversion_queue')
    .select('id, site_id, status, provider_error_code, last_error, attempt_count, updated_at')
    .in('status', ['FAILED', 'DEAD_LETTER_QUARANTINE'])
    .order('updated_at', { ascending: false })
    .limit(8000);

  if (siteId) q = q.eq('site_id', siteId);

  const { data: rows, error } = await q;
  if (error) throw error;

  const byCode = Object.create(null);
  for (const r of rows || []) {
    const code = r.provider_error_code?.trim() || '(null)';
    if (!byCode[code]) byCode[code] = { count: 0, statuses: Object.create(null), sample_last_error: null };
    byCode[code].count += 1;
    const st = r.status || '?';
    byCode[code].statuses[st] = (byCode[code].statuses[st] || 0) + 1;
    if (!byCode[code].sample_last_error && r.last_error) byCode[code].sample_last_error = String(r.last_error).slice(0, 200);
  }

  const sorted = Object.entries(byCode).sort((a, b) => b[1].count - a[1].count);
  const report = {
    generated_at: new Date().toISOString(),
    row_cap: 8000,
    site_filter: siteId ?? 'all',
    total_rows_sampled: (rows || []).length,
    by_provider_error_code: Object.fromEntries(sorted),
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('\n=== DLQ / FAILED autopsy (offline_conversion_queue) ===\n');
  console.log(`generated_at: ${report.generated_at}`);
  console.log(`rows_sampled: ${report.total_rows_sampled} (cap 8000)\n`);
  console.table(
    sorted.map(([code, v]) => ({
      provider_error_code: code,
      rows: v.count,
      FAILED: v.statuses.FAILED ?? 0,
      DLQ: v.statuses.DEAD_LETTER_QUARANTINE ?? 0,
      sample_last_error: v.sample_last_error ?? '',
    }))
  );
}

run().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
