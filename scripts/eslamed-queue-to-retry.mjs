#!/usr/bin/env node
/**
 * Eslamed: PROCESSING'deki satırları RETRY'a al (script yeniden alsın)
 *
 * Script INVALID_TIME_FORMAT ile atladı → ACK gitmedi → satırlar PROCESSING'de kaldı.
 * Export sadece QUEUED/RETRY alıyor. Bu script PROCESSING → RETRY yapar.
 *
 * Çalıştır: node scripts/eslamed-queue-to-retry.mjs
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config({ path: '.env' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, key);
const ESLAMED_SITE_ID = 'b1264552-c859-40cb-a3fb-0ba057afd070';

// PROCESSING satırları bul
const { data: rows, error: fetchErr } = await admin
  .from('offline_conversion_queue')
  .select('id, call_id, status, created_at')
  .eq('site_id', ESLAMED_SITE_ID)
  .eq('status', 'PROCESSING')
  .eq('provider_key', 'google_ads');

if (fetchErr) {
  console.error('Query error:', fetchErr.message);
  process.exit(1);
}

if (!rows?.length) {
  console.log('Eslamed için PROCESSING satır yok. (Zaten RETRY/COMPLETED veya queue boş)');
  process.exit(0);
}

console.log('PROCESSING → RETRY:', rows.length, 'satır');
for (const r of rows) {
  console.log('  -', r.id, 'call_id:', r.call_id);
}

const ids = rows.map((r) => r.id);
const { error: updateErr } = await admin
  .from('offline_conversion_queue')
  .update({
    status: 'RETRY',
    claimed_at: null,
    updated_at: new Date().toISOString(),
  })
  .eq('site_id', ESLAMED_SITE_ID)
  .in('id', ids)
  .eq('status', 'PROCESSING');

if (updateErr) {
  console.error('Update error:', updateErr.message);
  process.exit(1);
}

console.log('\n✓', ids.length, 'satır RETRY\'a alındı. Script bir sonraki çalıştırmada bu kayıtları alacak.');
console.log('  (Format fix deploy edildiyse +03:00 ile geçer)');
