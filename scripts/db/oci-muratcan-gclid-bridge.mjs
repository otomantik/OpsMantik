#!/usr/bin/env node
/**
 * GCLID Bridge (Fingerprint-to-GCLID): Aynı kullanıcının (fingerprint) son 14 gün içinde
 * GCLID'li başka bir session'ı var mı diye bakar; bulursa o GCLID'i kuyruk satırına yazar.
 * Böylece "sadece gbraid" olan conversion, aynı cihazın önceki tıklamasındaki GCLID ile gönderilebilir.
 *
 * Kullanım: node scripts/db/oci-muratcan-gclid-bridge.mjs
 *          node scripts/db/oci-muratcan-gclid-bridge.mjs --dry-run
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
const BRIDGE_DAYS = 14;
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
    console.log('Gclid olmayan (sadece gbraid/wbraid) kuyruk satırı yok.');
    process.exit(0);
  }

  console.log('Muratcan — GCLID Bridge (aynı fingerprint, son 14 gün, GCLID\'li session)');
  console.log('Hedef satır:', onlyGbraidOrWbraid.length);
  console.log('');

  let updated = 0;
  for (const row of onlyGbraidOrWbraid) {
    const { data: callRow } = await supabase
      .from('calls')
      .select('matched_fingerprint, matched_at')
      .eq('id', row.call_id)
      .eq('site_id', MURATCAN_SITE_ID)
      .maybeSingle();

    const fingerprint = callRow?.matched_fingerprint != null && String(callRow.matched_fingerprint).trim() !== ''
      ? String(callRow.matched_fingerprint).trim()
      : null;

    if (!fingerprint) {
      console.log('  ', row.id.slice(0, 8) + '...', 'call\'da matched_fingerprint yok, atlanıyor');
      continue;
    }

    const since = new Date(Date.now() - BRIDGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, gclid, created_at')
      .eq('site_id', MURATCAN_SITE_ID)
      .eq('fingerprint', fingerprint)
      .not('gclid', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);

    const otherSession = sessions?.[0];
    const bridgedGclid = otherSession?.gclid != null && String(otherSession.gclid).trim() !== ''
      ? String(otherSession.gclid).trim()
      : null;

    if (!bridgedGclid) {
      console.log('  ', row.id.slice(0, 8) + '...', `fingerprint=${fingerprint.slice(0, 12)}... son ${BRIDGE_DAYS} günde GCLID\'li session yok`);
      continue;
    }

    const gclidNormalized = normalize(bridgedGclid);
    console.log('  ', row.id.slice(0, 8) + '...', `bridge bulundu: session ${otherSession.id?.slice(0, 8)}... gclid → kuyruğa (${gclidNormalized.slice(0, 24)}...) value=${row.value_cents != null ? (row.value_cents / 100) + ' TL' : '-'}`);

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

  console.log('');
  if (dryRun) {
    console.log('--dry-run: Güncelleme yapılmadı.');
  } else {
    console.log('Sonuç:', updated, 'satır bridge GCLID ile güncellendi ve QUEUED. Worker/cron çalıştır.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
