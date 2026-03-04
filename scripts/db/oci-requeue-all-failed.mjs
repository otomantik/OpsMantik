#!/usr/bin/env node
/**
 * Tüm FAILED/RETRY (google_ads) dönüşümleri QUEUED yap.
 * Script export ile çalışacak siteler için. İsteğe bağlı: hem gclid hem gbraid olanlarda sadece gclid bırak.
 *
 * Kullanım: node scripts/db/oci-requeue-all-failed.mjs
 *           node scripts/db/oci-requeue-all-failed.mjs --dry-run
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
const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();

async function run() {
  console.log('Tüm FAILED/RETRY (google_ads) → QUEUED');
  if (dryRun) console.log('--dry-run: Değişiklik yapılmayacak.\n');

  const { data: rows, error } = await supabase
    .from('offline_conversion_queue')
    .select('id, site_id, gclid, wbraid, gbraid')
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

  // Sadece gclid: hem gclid hem gbraid/wbraid olanlarda wbraid/gbraid temizle
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

  // Tümünü QUEUED yap
  const ids = rows.map((r) => r.id);
  if (!dryRun) {
    const { error: upErr } = await supabase
      .from('offline_conversion_queue')
      .update({
        status: 'QUEUED',
        next_retry_at: oneMinAgo,
        retry_count: 0,
        attempt_count: 0,
        last_error: null,
        provider_error_code: null,
        provider_error_category: null,
        claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('provider_key', 'google_ads')
      .in('id', ids);

    if (upErr) {
      console.error('QUEUED güncelleme hatası:', upErr.message);
      process.exit(1);
    }
    console.log('2) Tüm', ids.length, 'satır QUEUED yapıldı. Script export ile alınabilir.');
  } else {
    console.log('2) Tüm', rows.length, 'satır QUEUED yapılacak.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
