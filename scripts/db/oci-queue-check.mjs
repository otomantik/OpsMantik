#!/usr/bin/env node
/**
 * OCI kuyruk kontrolu — Export API'nin donecegi satirlari gosterir
 * "Islenecek kayit bulunamadi" nedenini tespit et.
 *
 * Kullanim:
 *   node scripts/db/oci-queue-check.mjs Eslamed
 *   node scripts/db/oci-queue-check.mjs 81d957f3c7534f53b12ff305f9f07ae7
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith('-'));

async function resolveSite(q) {
  if (!q) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hex32 = /^[0-9a-f]{32}$/i;
  if (uuidRegex.test(q)) {
    const { data } = await supabase.from('sites').select('id, name, public_id, oci_sync_method').eq('id', q).maybeSingle();
    return data || null;
  }
  if (hex32.test(q)) {
    const { data } = await supabase.from('sites').select('id, name, public_id, oci_sync_method').eq('public_id', q).maybeSingle();
    return data || null;
  }
  const { data } = await supabase
    .from('sites')
    .select('id, name, public_id, oci_sync_method')
    .or(`name.ilike.%${q}%,domain.ilike.%${q}%`)
    .limit(1);
  return data?.[0] || null;
}

async function run() {
  const site = await resolveSite(query);
  if (!site) {
    console.error('Site bulunamadi:', query || '(bos)');
    console.error('Ornek: node scripts/db/oci-queue-check.mjs Eslamed');
    process.exit(1);
  }

  const siteId = site.id;
  console.log('--- SITE ---');
  console.log('UUID:', siteId);
  console.log('public_id:', site.public_id || '(yok)');
  console.log('name:', site.name);
  console.log('oci_sync_method:', site.oci_sync_method || 'script');
  if (site.oci_sync_method === 'api') {
    console.log('\n!!! UYARI: oci_sync_method=api -> Script export 400 dondurur! Backend worker kullanilmali.');
  }

  // Export API query: QUEUED, RETRY, provider_key=google_ads
  const { data: exportRows, error } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, provider_key, gclid, wbraid, gbraid, conversion_time')
    .eq('site_id', siteId)
    .in('status', ['QUEUED', 'RETRY'])
    .eq('provider_key', 'google_ads')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Kuyruk hatasi:', error.message);
    process.exit(1);
  }

  console.log('\n--- EXPORT API GORE ALINACAK SATIRLAR (QUEUED/RETRY, google_ads) ---');
  console.log('Adet:', exportRows?.length ?? 0);
  if (exportRows?.length) {
    console.table(exportRows.map((r) => ({
      id: r.id?.slice(0, 8) + '...',
      call_id: r.call_id?.slice(0, 8) + '...',
      status: r.status,
      gclid: r.gclid ? 'var' : '-',
      wbraid: r.wbraid ? 'var' : '-',
      gbraid: r.gbraid ? 'var' : '-',
      conv_time: r.conversion_time ? r.conversion_time.slice(0, 19) : '-',
    })));
  } else {
    console.log('(Bos - "Islenecek kayit bulunamadi" sebebi)');
  }

  // COMPLETED detay (uploaded_at - reset edilebilir mi?)
  const { data: completedRows } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, uploaded_at, updated_at')
    .eq('site_id', siteId)
    .eq('status', 'COMPLETED');
  if (completedRows?.length) {
    console.log('\n--- COMPLETED SATIRLAR (uploaded_at=null -> oci-enqueue reset eder) ---');
    completedRows.forEach((r) => {
      console.log('  id:', r.id?.slice(0, 8) + '...', '| uploaded_at:', r.uploaded_at || 'NULL', '|', r.updated_at?.slice(0, 19));
    });
  }

  // Tum kuyruk ozeti
  const { data: allRows } = await supabase
    .from('offline_conversion_queue')
    .select('status, provider_key')
    .eq('site_id', siteId);
  const byStatus = (allRows || []).reduce((acc, r) => {
    const k = `${r.status}:${r.provider_key || 'null'}`;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  console.log('\n--- TUM KUYRUK (status:provider_key) ---');
  Object.entries(byStatus).sort().forEach(([k, v]) => console.log(' ', k, ':', v));

  if ((exportRows?.length ?? 0) === 0 && (allRows?.length ?? 0) > 0) {
    const hasQueued = (allRows || []).some((r) => r.status === 'QUEUED' || r.status === 'RETRY');
    const wrongProvider = (allRows || []).some((r) => (r.provider_key || '').toLowerCase() !== 'google_ads');
    const inProcessing = (allRows || []).filter((r) => r.status === 'PROCESSING').length;
    const inCompleted = (allRows || []).filter((r) => r.status === 'COMPLETED').length;
    console.log('\n--- ONERI ---');
    if (inProcessing > 0) {
      console.log('- PROCESSING:', inProcessing, '-> oci-enqueue reset yap (PROCESSING->QUEUED)');
    }
    if (inCompleted > 0 && !hasQueued) {
      console.log('- COMPLETED (uploaded_at null olanlar) -> oci-enqueue reset yap');
    }
    if (!hasQueued && (allRows?.length ?? 0) > 0) {
      console.log('- npm run db:enqueue:today veya npm run db:enqueue Eslamed');
    }
    if (wrongProvider) {
      console.log('- Bazi satirlar provider_key != google_ads; export sadece google_ads alir');
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
