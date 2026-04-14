/**
 * One-off: print offline_conversion_queue summary for a site UUID.
 * Usage: node scripts/db/dump-oci-queue-site.mjs <site_uuid>
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: join(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SITE = process.argv[2];
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!SITE) {
  console.error('Usage: node scripts/db/dump-oci-queue-site.mjs <site_uuid>');
  process.exit(1);
}

const sb = createClient(url, key);

const { data: rows, error } = await sb
  .from('offline_conversion_queue')
  .select(
    'id, status, provider_key, value_cents, attempt_count, last_error, provider_error_code, claimed_at, uploaded_at, created_at',
  )
  .eq('site_id', SITE);

if (error) {
  console.error(error);
  process.exit(1);
}

const counts = {};
for (const r of rows || []) {
  const k = `${r.status}:${r.provider_key || 'null'}`;
  counts[k] = (counts[k] || 0) + 1;
}

console.log('Site:', SITE);
console.log('Toplam satır:', rows?.length ?? 0);
console.log('status:provider_key -> adet');
console.log(JSON.stringify(counts, null, 2));

const sorted = [...(rows || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
console.log('\nSon 50 (created_at desc):');
for (const r of sorted.slice(0, 50)) {
  const val = r.value_cents != null ? (Number(r.value_cents) / 100).toFixed(2) : '';
  console.log(
    [
      r.status,
      r.provider_key || '-',
      `TRY ${val}`,
      `att=${r.attempt_count ?? 0}`,
      r.created_at ? String(r.created_at).slice(0, 19) : '',
      r.uploaded_at ? `up=${String(r.uploaded_at).slice(0, 19)}` : '',
      r.last_error ? String(r.last_error).slice(0, 60) : '',
    ].join(' | '),
  );
}
