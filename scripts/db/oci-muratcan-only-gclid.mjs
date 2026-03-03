#!/usr/bin/env node
/**
 * Muratcan: Kuyrukta hem gclid hem gbraid/wbraid olan satırlarda sadece gclid bırak.
 * INVALID_CLICK_ID_FORMAT bazen "aynı conversion'a iki ID gönderme" veya yanlış tip göndermekten olur.
 * Bu script gclid dolu satırlarda wbraid/gbraid'i temizleyip satırı QUEUED yapar — tekrar sadece gclid gider.
 *
 * Kullanım: node scripts/db/oci-muratcan-only-gclid.mjs
 *          node scripts/db/oci-muratcan-only-gclid.mjs --dry-run
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
  const { data: rows, error } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, gclid, wbraid, gbraid, value_cents')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads');

  if (error) {
    console.error('Hata:', error.message);
    process.exit(1);
  }

  const hasGclidAndOther = (rows || []).filter(
    (r) => r.gclid && (r.wbraid || r.gbraid)
  );

  if (hasGclidAndOther.length === 0) {
    console.log('Hem gclid hem gbraid/wbraid olan satır yok. Çalıştırılacak işlem yok.');
    process.exit(0);
  }

  console.log('Muratcan — Sadece gclid (gbraid/wbraid temizlenecek)');
  console.log('Bulunan satır:', hasGclidAndOther.length);
  hasGclidAndOther.forEach((r, i) => {
    console.log(`  ${i + 1}. id=${r.id.slice(0, 8)}... call=${r.call_id?.slice(0, 8)}... value=${r.value_cents != null ? (r.value_cents / 100) + ' TL' : '-'} status=${r.status}`);
  });

  if (dryRun) {
    console.log('\n--dry-run: Güncelleme yapılmadı.');
    process.exit(0);
  }

  let updated = 0;
  for (const row of hasGclidAndOther) {
    const { error: upErr } = await supabase
      .from('offline_conversion_queue')
      .update({
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
      console.error('Güncelleme hatası', row.id, upErr.message);
      continue;
    }
    updated++;
  }
  console.log('\nSonuç:', updated, 'satır güncellendi (sadece gclid kaldı, QUEUED). Worker/cron çalıştır.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
