#!/usr/bin/env node
/**
 * Muratcan: Sadece gbraid olan (gclid olmayan) kuyruk satırlarında session'dan gclid al, kuyruğa yaz.
 * Böylece "sadece gbraid" giden ve INVALID_CLICK_ID_FORMAT alan satırlar gclid ile tekrar denesin.
 *
 * Kullanım: node scripts/db/oci-muratcan-backfill-gclid-from-session.mjs
 *          node scripts/db/oci-muratcan-backfill-gclid-from-session.mjs --dry-run
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
const dryRun = process.argv.includes('--dry-run');

const MURATCAN_SITE_ID = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';
const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();

function normalize(val) {
  if (val == null || typeof val !== 'string') return val ?? '';
  return val.trim().replace(/-/g, '+').replace(/_/g, '/');
}

async function run() {
  const { data: rows, error } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, gclid, gbraid, wbraid, value_cents')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads');

  if (error) {
    console.error('Hata:', error.message);
    process.exit(1);
  }

  const onlyGbraidOrWbraid = (rows || []).filter(
    (r) => !r.gclid && (r.gbraid || r.wbraid)
  );

  if (onlyGbraidOrWbraid.length === 0) {
    console.log('Gclid olmayan (sadece gbraid/wbraid) satır yok.');
    process.exit(0);
  }

  console.log('Muratcan — Session\'dan gclid backfill (sadece gbraid/wbraid olan satırlar)');
  console.log('Bulunan satır:', onlyGbraidOrWbraid.length);

  let updated = 0;
  for (const row of onlyGbraidOrWbraid) {
    const { data: rpcRows } = await supabase.rpc('get_call_session_for_oci', {
      p_call_id: row.call_id,
      p_site_id: MURATCAN_SITE_ID,
    });
    const sessionRow = Array.isArray(rpcRows) && rpcRows.length > 0 ? rpcRows[0] : null;
    const sessionGclid = sessionRow?.gclid != null && String(sessionRow.gclid).trim() !== '' ? String(sessionRow.gclid).trim() : null;
    if (!sessionGclid) {
      console.log('  ', row.id.slice(0, 8) + '...', 'session\'da gclid yok, atlanıyor');
      continue;
    }

    const gclidNormalized = normalize(sessionGclid);
    console.log('  ', row.id.slice(0, 8) + '...', `session gclid → kuyruğa yazılacak (${gclidNormalized.slice(0, 24)}...) value=${row.value_cents != null ? (row.value_cents / 100) + ' TL' : '-'}`);

    if (dryRun) continue;

    const { error: upErr } = await supabase
      .from('offline_conversion_queue')
      .update({
        gclid: gclidNormalized,
        wbraid: null,
        gbraid: null,
        status: 'QUEUED',
        next_retry_at: oneMinAgo,
        retry_count: 0,
        last_error: null,
        provider_error_code: null,
        provider_error_category: null,
        claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (upErr) {
      console.error('    Güncelleme hatası:', upErr.message);
      continue;
    }
    updated++;
  }

  if (dryRun) {
    console.log('\n--dry-run: Güncelleme yapılmadı.');
  } else {
    console.log('\nSonuç:', updated, 'satır session gclid ile güncellendi ve QUEUED. Worker/cron çalıştır.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
