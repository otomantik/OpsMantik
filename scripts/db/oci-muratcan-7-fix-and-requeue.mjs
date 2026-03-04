#!/usr/bin/env node
/**
 * Muratcan AKÜ — 7 FAILED dönüşümü gönderilebilir formata getir + QUEUED yap.
 * 1) Hem gclid hem gbraid/wbraid olanlarda sadece gclid bırak.
 * 2) GCLID'siz 1 satırda session'dan gclid backfill dene.
 * 3) Tüm 7 satırı QUEUED + next_retry_at geçmişe al (worker hemen alsın).
 *
 * Kullanım: node scripts/db/oci-muratcan-7-fix-and-requeue.mjs
 *           node scripts/db/oci-muratcan-7-fix-and-requeue.mjs --dry-run
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

async function run() {
  console.log('Muratcan AKÜ — 7 dönüşüm: format düzelt + QUEUED');
  if (dryRun) console.log('--dry-run: Değişiklik yapılmayacak.\n');

  const { data: rows, error } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, gclid, wbraid, gbraid')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads')
    .in('status', ['FAILED', 'RETRY']);

  if (error) {
    console.error('Kuyruk hatası:', error.message);
    process.exit(1);
  }
  if (!rows?.length) {
    console.log('FAILED/RETRY satır yok.');
    process.exit(0);
  }

  console.log('Bulunan satır:', rows.length);

  // 1) Sadece gclid: hem gclid hem gbraid/wbraid olanlarda wbraid/gbraid temizle
  const hasGclidAndOther = rows.filter((r) => r.gclid && (r.wbraid || r.gbraid));
  if (hasGclidAndOther.length > 0 && !dryRun) {
    for (const row of hasGclidAndOther) {
      await supabase
        .from('offline_conversion_queue')
        .update({
          wbraid: null,
          gbraid: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    }
    console.log('1) Sadece gclid:', hasGclidAndOther.length, 'satırda wbraid/gbraid temizlendi.');
  } else if (hasGclidAndOther.length > 0) {
    console.log('1) Sadece gclid:', hasGclidAndOther.length, 'satırda wbraid/gbraid temizlenecek.');
  }

  // 2) GCLID'siz 1 satır: session'dan gclid backfill (get_call_session_for_oci)
  const noGclid = rows.filter((r) => !r.gclid || (typeof r.gclid === 'string' && !r.gclid.trim()));
  for (const row of noGclid) {
    const { data: rpcRows } = await supabase.rpc('get_call_session_for_oci', {
      p_call_id: row.call_id,
      p_site_id: MURATCAN_SITE_ID,
    });
    const session = Array.isArray(rpcRows) && rpcRows.length > 0 ? rpcRows[0] : null;
    const sessionGclid = session?.gclid != null && String(session.gclid).trim() !== '' ? String(session.gclid).trim() : null;
    if (sessionGclid && !dryRun) {
      await supabase
        .from('offline_conversion_queue')
        .update({ gclid: sessionGclid, wbraid: null, gbraid: null, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      console.log('2) GCLID backfill: queue_id', row.id.slice(0, 8), '→ session gclid yazıldı.');
    } else if (noGclid.length > 0) {
      console.log('2) GCLID\'siz satır:', row.id.slice(0, 8), '— session\'da gclid', sessionGclid ? 'var (yazılacak)' : 'yok. GCLID bridge veya Enhanced Conversions gerekebilir.');
    }
  }

  // 3) Tüm 7'yi QUEUED yap, next_retry_at geçmişe
  if (!dryRun) {
    const ids = rows.map((r) => r.id);
    const { error: upErr } = await supabase
      .from('offline_conversion_queue')
      .update({
        status: 'QUEUED',
        next_retry_at: oneMinAgo,
        retry_count: 0,
        last_error: null,
        provider_error_code: null,
        provider_error_category: null,
        claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('site_id', MURATCAN_SITE_ID)
      .eq('provider_key', 'google_ads')
      .in('id', ids);

    if (upErr) {
      console.error('QUEUED güncelleme hatası:', upErr.message);
      process.exit(1);
    }
    console.log('3) Tüm', ids.length, 'satır QUEUED yapıldı (next_retry_at geçmişe). Worker/cron çalıştır.');
  } else {
    console.log('3) Tüm', rows.length, 'satır QUEUED yapılacak.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
