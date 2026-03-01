#!/usr/bin/env node
/**
 * OCI Session dedup kontrolu — Kuyruk satirlarinin matched_session_id'lerini gosterir.
 * Ayni session'a ait satirlar export'ta teklelenir (1 tane gonderilir).
 *
 * Kullanim: node scripts/db/oci-diagnostic-sessions.mjs Eslamed
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
const query = process.argv[2] || 'Eslamed';

async function resolveSite(q) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hex32 = /^[0-9a-f]{32}$/i;
  if (uuidRegex.test(q)) {
    const { data } = await supabase.from('sites').select('id, name').eq('id', q).maybeSingle();
    return data || null;
  }
  if (hex32.test(q)) {
    const { data } = await supabase.from('sites').select('id, name').eq('public_id', q).maybeSingle();
    return data || null;
  }
  const { data } = await supabase.from('sites').select('id, name').or(`name.ilike.%${q}%,domain.ilike.%${q}%`).limit(1);
  return data?.[0] || null;
}

async function run() {
  const site = await resolveSite(query);
  if (!site) {
    console.error('Site bulunamadi:', query);
    process.exit(1);
  }

  const { data: rows, error } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, provider_error_code, last_error, conversion_time, gclid, wbraid, gbraid')
    .eq('site_id', site.id)
    .eq('provider_key', 'google_ads')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Hata:', error.message);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log(site.name, '- kuyrukta kayit yok.');
    return;
  }

  const callIds = rows.map((r) => r.call_id).filter(Boolean);
  const { data: calls } = await supabase
    .from('calls')
    .select('id, matched_session_id')
    .eq('site_id', site.id)
    .in('id', callIds);

  const callMap = new Map((calls || []).map((c) => [c.id, c]));

  const sessionCounts = new Map();
  rows.forEach((r) => {
    const c = callMap.get(r.call_id);
    const sid = c?.matched_session_id || null;
    const key = sid || '(session yok)';
    sessionCounts.set(key, (sessionCounts.get(key) || 0) + 1);
  });

  console.log('---', site.name, 'OCI Session Diagnostik ---\n');
  console.log('Toplam kuyruk:', rows.length);
  console.log('\nSession dagilimi (aynı session = export\'ta teklelenir):');
  for (const [s, n] of sessionCounts) {
    console.log(' ', s === '(session yok)' ? '(matched_session_id yok)' : s?.slice(0, 8) + '...', '->', n, 'satir');
  }
  console.log('\n--- Satir detaylari ---');
  console.table(rows.map((r) => {
    const c = callMap.get(r.call_id);
    const sid = c?.matched_session_id;
    return {
      queue_id: r.id?.slice(0, 8) + '...',
      call_id: r.call_id?.slice(0, 8) + '...',
      status: r.status,
      session_id: sid ? sid.slice(0, 8) + '...' : '-',
      hata: r.provider_error_code || '-',
      conv_time: r.conversion_time ? r.conversion_time.slice(0, 19) : '-',
    };
  }));

  const uniqueSessions = new Set(rows.map((r) => {
    const c = callMap.get(r.call_id);
    return c?.matched_session_id || '(yok)';
  }));
  const deduped = uniqueSessions.size;
  console.log('\n--- Sonuc ---');
  console.log('Farkli session sayisi:', deduped);
  console.log('Export\'a gidecek max satir:', deduped);
  if (rows.length > deduped) {
    console.log('Session dedup sebebiyle atlanacak:', rows.length - deduped, 'satir');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
