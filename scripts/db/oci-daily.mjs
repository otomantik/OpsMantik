#!/usr/bin/env node
/**
 * OCI günlük sorgular — kuyruk özeti, bugün Google sonucu
 *
 * Kullanım:
 *   node scripts/db/oci-daily.mjs Eslamed
 *   node scripts/db/oci-daily.mjs b1264552-c859-40cb-a3fb-0ba057afd070
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

async function resolveSiteId(q) {
  if (!q) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(q)) {
    const { data } = await supabase.from('sites').select('id, name').eq('id', q).maybeSingle();
    return data?.id || null;
  }
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .or(`name.ilike.%${q}%,domain.ilike.%${q}%,public_id.eq.${q}`)
    .limit(1);
  return data?.[0]?.id || null;
}

async function run() {
  const siteId = await resolveSiteId(query);
  if (!siteId) {
    console.error('Site bulunamadi:', query || '(bos)');
    console.error('Ornek: node scripts/db/oci-daily.mjs Eslamed');
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

  // 1) Kuyruk ozeti (status dagilimi)
  const { data: rows } = await supabase
    .from('offline_conversion_queue')
    .select('status')
    .eq('site_id', siteId);

  const byStatus = (rows || []).reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log('--- KUYRUK OZET ---');
  console.log('QUEUED:', byStatus.QUEUED ?? 0);
  console.log('PROCESSING:', byStatus.PROCESSING ?? 0);
  console.log('COMPLETED:', byStatus.COMPLETED ?? 0);
  console.log('FAILED:', byStatus.FAILED ?? 0);
  console.log('RETRY:', byStatus.RETRY ?? 0);
  console.log('Toplam:', rows?.length ?? 0);

  // 2) Bugün Google'a giden veya hata alan
  const { data: todayRows } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, uploaded_at, provider_error_code, last_error')
    .eq('site_id', siteId)
    .gte('updated_at', today)
    .lt('updated_at', tomorrow)
    .order('updated_at', { ascending: false })
    .limit(50);

  console.log('\n--- BUGUN GOOGLE SONUC (max 50) ---');
  if (!todayRows?.length) {
    console.log('Bugun giden / hata alan kayit yok.');
  } else {
    console.table(todayRows.map((r) => ({
      id: r.id?.slice(0, 8),
      status: r.status,
      uploaded: r.uploaded_at ? '✓' : '-',
      err: r.provider_error_code || '-',
    })));
  }

  console.log('\nTam veri: docs/runbooks/oci_eslamed_bugun_google_sonuc.sql');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
