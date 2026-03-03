#!/usr/bin/env node
/**
 * Muratcan: Kuyruktaki GCLID'leri kontrol et.
 * Veritabanında ne var, Google'a böyle gidecek (normalize) — base64url ise uyar.
 *
 * Kullanım: node scripts/db/oci-check-muratcan-gclids.mjs
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

function normalize(val) {
  if (val == null || typeof val !== 'string') return val ?? '';
  return val.trim().replace(/-/g, '+').replace(/_/g, '/');
}

function isBase64Url(val) {
  if (val == null || typeof val !== 'string') return false;
  const t = val.trim();
  return t.length > 0 && (t.includes('_') || t.includes('-'));
}

function show(field, raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const r = String(raw).trim();
  const norm = normalize(r);
  const bad = isBase64Url(r);
  return { field, raw: r, normalized: norm, needsFix: bad };
}

async function run() {
  console.log('Muratcan AKÜ — Kuyruk GCLID kontrolü');
  console.log('Site ID:', MURATCAN_SITE_ID);
  console.log('');

  const { data: rows, error } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, gclid, wbraid, gbraid, value_cents, conversion_time, last_error')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Hata:', error.message);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log('Kuyrukta Muratcan için satır yok.');
    process.exit(0);
  }

  let hasBad = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const parts = [
      show('gclid', r.gclid),
      show('wbraid', r.wbraid),
      show('gbraid', r.gbraid),
    ].filter(Boolean);

    if (parts.length === 0) {
      console.log(`--- ${i + 1}. [${r.id.slice(0, 8)}...] call=${r.call_id?.slice(0, 8)}... status=${r.status} ---`);
      console.log('  (gclid/wbraid/gbraid hepsi boş)');
      console.log('');
      continue;
    }

    console.log(`--- ${i + 1}. [${r.id.slice(0, 8)}...] call=${r.call_id?.slice(0, 8)}... status=${r.status} value=${r.value_cents != null ? (r.value_cents / 100) + ' TL' : '-'} ---`);
    for (const p of parts) {
      console.log(`  ${p.field}:`);
      console.log(`    Veritabanında:    ${p.raw}`);
      console.log(`    Google'a gidecek: ${p.normalized}`);
      if (p.needsFix) {
        console.log('    ⚠ base64url (_/-) — düzeltilmeli, sonra kuyruğa alınıp tekrar gönderilmeli.');
        hasBad++;
      } else {
        console.log('    ✓ standart base64');
      }
    }
    if (r.last_error) console.log('  last_error:', r.last_error.slice(0, 80) + (r.last_error.length > 80 ? '...' : ''));
    console.log('');
  }

  console.log('--- Özet ---');
  const badRows = rows.filter((r) => isBase64Url(r.gclid) || isBase64Url(r.wbraid) || isBase64Url(r.gbraid));
  if (badRows.length > 0) {
    console.log(`${badRows.length} satırda hâlâ base64url var. Şunu çalıştır:`);
    console.log('  node scripts/db/oci-fix-gclid-decode.mjs Muratcan');
    console.log('Sonra OCI worker/cron çalıştır veya bekle.');
  } else {
    console.log('Tüm satırlarda GCLID/wbraid/gbraid zaten standart base64.');
  }
  const failedWithFormat = rows.filter((r) => r.status === 'FAILED' && r.last_error && r.last_error.includes('INVALID_CLICK_ID_FORMAT'));
  if (failedWithFormat.length > 0) {
    console.log('');
    console.log('INVALID_CLICK_ID_FORMAT alan satırlar:', failedWithFormat.length);
    const withBoth = failedWithFormat.filter((r) => (r.gclid && r.gbraid) || (r.gclid && r.wbraid) || (r.wbraid && r.gbraid));
    const onlyGbraid = failedWithFormat.filter((r) => !r.gclid && !r.wbraid && r.gbraid);
    if (withBoth.length > 0) {
      console.log('  →', withBoth.length, 'satırda hem gclid hem gbraid/wbraid var. API\'ye şu an sadece gclid gidiyor.');
      console.log('  Sadece gclid göndermek için: node scripts/db/oci-muratcan-only-gclid.mjs');
    }
    if (onlyGbraid.length > 0) {
      console.log('  →', onlyGbraid.length, 'satırda sadece gbraid var (gclid yok). Bu hesap gbraid kabul etmiyor olabilir.');
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
