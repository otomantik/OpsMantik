#!/usr/bin/env node
/**
 * Tüm FAILED/RETRY (google_ads) dönüşümleri RETRY yap (manual retry; DB trigger FAILED→RETRY izin verir, QUEUED vermez).
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
  console.log('Tüm FAILED/RETRY (google_ads) → RETRY (manual retry)');
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

  // Tümünü RETRY yap (next_retry_at geçmişte → worker hemen alır; FAILED→RETRY trigger’da izinli)
  const ids = rows.map((r) => r.id);
  if (!dryRun) {
    const createdAt = new Date().toISOString();
    const transitionRows = ids.map((id) => ({
      queue_id: id,
      new_status: 'RETRY',
      error_payload: {
        retry_count: 0,
        attempt_count: 0,
        next_retry_at: oneMinAgo,
        clear_fields: ['last_error', 'provider_error_code', 'provider_error_category', 'claimed_at'],
      },
      actor: 'MANUAL',
      created_at: createdAt,
    }));

    for (let i = 0; i < transitionRows.length; i += 500) {
      const chunk = transitionRows.slice(i, i + 500);
      const { error: upErr } = await supabase
        .from('oci_queue_transitions')
        .insert(chunk);

      if (upErr) {
        console.error('RETRY ledger insert hatası:', upErr.message);
        process.exit(1);
      }
    }

    console.log('2) Tüm', ids.length, 'satır RETRY yapıldı. Worker script export ile alır.');
  } else {
    console.log('2) Tüm', rows.length, 'satır RETRY yapılacak.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
