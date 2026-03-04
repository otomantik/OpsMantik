#!/usr/bin/env node
/**
 * Muratcan V3 Nitelikli Görüşme — conversion_value 1000 TL → matematiğe göre (100 TRY).
 * Neden 1000: floor (min_conversion_value_cents=100000) hesaplanan değeri 1000 TRY'ye çekiyordu.
 * Matematik: AOV × qualified(0.2) × decay(0.5) = 1000 × 0.2 × 0.5 = 100 TRY.
 *
 * Kullanım: node scripts/db/oci-muratcan-v3-value-fix.mjs
 *           node scripts/db/oci-muratcan-v3-value-fix.mjs --dry-run
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
const MURATCAN_SITE_ID = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';
const V3_NAME = 'OpsMantik_V3_Nitelikli_Gorusme';

// Matematik: AOV 1000, qualified 0.2, decay 0.5 (gün 0-3) → 100 TRY
const V3_CALCULATED_VALUE_MAJOR = 100;

async function run() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Muratcan V3 Nitelikli Görüşme — Değer düzeltmesi (matematiğe göre)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('--- Neden 1000 TL geliyordu? ---');
  console.log('  Floor: finalCents = max(hesaplanan, min_conversion_value_cents)');
  console.log('  min_conversion_value_cents = 100000 (1000 TRY) varsayılan.');
  console.log('  Hesaplanan V3 = AOV×0.2×decay = 1000×0.2×0.5 = 100 TRY → 10000 cents.');
  console.log('  10000 < 100000 → floor uygulandı → 1000 TRY yazıldı.\n');

  console.log('--- Bizim matematik ---');
  console.log('  V3 = AOV × intent_weights.qualified × decay(gün)');
  console.log('  qualified = 0.2, decay(gün≤3) = 0.5 → 1000 × 0.2 × 0.5 = 100 TRY.\n');

  const { data: rows, error } = await supabase
    .from('marketing_signals')
    .select('id, google_conversion_name, conversion_value, expected_value_cents, dispatch_status')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('google_conversion_name', V3_NAME)
    .eq('dispatch_status', 'PENDING');

  if (error) {
    console.error('Sinyal hatası:', error.message);
    process.exit(1);
  }
  if (!rows?.length) {
    console.log('PENDING V3 sinyal yok. Bitti.');
    process.exit(0);
  }

  console.log('--- Güncellenecek satırlar ---');
  rows.forEach((r, i) => {
    console.log('  ' + (i + 1) + '. id=' + r.id?.slice(0, 8) + '... eski conversion_value=' + r.conversion_value + ' → yeni ' + V3_CALCULATED_VALUE_MAJOR + ' TRY');
  });

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('\n[--dry-run] UPDATE yapılmadı.');
    process.exit(0);
  }

  const ids = rows.map((r) => r.id);
  const { error: upErr } = await supabase
    .from('marketing_signals')
    .update({
      conversion_value: V3_CALCULATED_VALUE_MAJOR,
      expected_value_cents: V3_CALCULATED_VALUE_MAJOR * 100,
    })
    .in('id', ids)
    .eq('site_id', MURATCAN_SITE_ID);

  if (upErr) {
    console.error('UPDATE hatası:', upErr.message);
    process.exit(1);
  }
  console.log('\nGüncellenen: ' + ids.length + ' satır (conversion_value = ' + V3_CALCULATED_VALUE_MAJOR + ' TRY).');
  console.log('Migration ile floor düşürüldü: supabase/migrations/20260709000000_muratcan_signal_floor_50_try.sql');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
