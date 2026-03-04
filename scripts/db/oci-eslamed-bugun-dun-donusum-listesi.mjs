#!/usr/bin/env node
/**
 * Eslamed — Bugün ve dün tüm dönüşümler: ad + değer listesi.
 * Kaynak: offline_conversion_queue (V5) + marketing_signals (V2/V3/V4).
 * Kullanım: node scripts/db/oci-eslamed-bugun-dun-donusum-listesi.mjs
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

const V5_NAME = 'OpsMantik_V5_DEMIR_MUHUR';

async function resolveSiteId(q) {
  if (!q) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(q)) {
    const { data } = await supabase.from('sites').select('id, name').eq('id', q).maybeSingle();
    return data?.id || null;
  }
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .or('name.ilike.%' + q + '%,domain.ilike.%' + q + '%')
    .limit(1);
  return data?.[0]?.id ?? null;
}

function centsToTry(cents, currency = 'TRY') {
  if (currency === 'TRY') return (Number(cents) / 100).toFixed(2) + ' TL';
  return (Number(cents) / 100).toFixed(2) + ' ' + currency;
}

async function run() {
  const siteId = await resolveSiteId('Eslamed');
  if (!siteId) {
    console.error('Site bulunamadi: Eslamed');
    process.exit(1);
  }

  const { data: siteRow } = await supabase.from('sites').select('name').eq('id', siteId).maybeSingle();
  const siteName = siteRow?.name || 'Eslamed';

  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  const dayAfterTomorrow = new Date(todayStart);
  dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 2);

  const fromIso = yesterdayStart.toISOString();
  const toIso = dayAfterTomorrow.toISOString();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Eslamed — Bugün ve dün tüm dönüşümler (ad + değer)');
  console.log('  Tarih aralığı (UTC):', yesterdayStart.toISOString().slice(0, 10), '–', todayStart.toISOString().slice(0, 10));
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1) offline_conversion_queue — V5 (Demir Mühür), conversion_time bugün/dün
  const { data: queueRows, error: qErr } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, value_cents, currency, conversion_time, created_at')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .gte('conversion_time', fromIso)
    .lt('conversion_time', toIso)
    .order('conversion_time', { ascending: true });

  if (qErr) {
    console.error('Kuyruk hatası:', qErr.message);
    process.exit(1);
  }

  const queueList = (queueRows || []).map((r) => ({
    kaynak: 'queue',
    donusum_adi: V5_NAME,
    tutar_cents: r.value_cents ?? 0,
    currency: r.currency || 'TRY',
    conversion_time: r.conversion_time,
    status: r.status,
  }));

  // 2) marketing_signals — V2/V3/V4, google_conversion_time bugün/dün (tüm dispatch_status)
  const { data: signalRows, error: sErr } = await supabase
    .from('marketing_signals')
    .select('id, google_conversion_name, google_conversion_time, conversion_value, dispatch_status')
    .eq('site_id', siteId)
    .gte('google_conversion_time', fromIso)
    .lt('google_conversion_time', toIso)
    .order('google_conversion_time', { ascending: true });

  if (sErr) {
    console.error('Sinyal hatası:', sErr.message);
    process.exit(1);
  }

  const signalList = (signalRows || []).map((r) => ({
    kaynak: 'signal',
    donusum_adi: r.google_conversion_name || 'OpsMantik_Signal',
    tutar_cents: r.conversion_value != null ? Math.round(Number(r.conversion_value) * 100) : 0,
    currency: 'TRY',
    conversion_time: r.google_conversion_time,
    status: r.dispatch_status,
  }));

  const all = [...queueList, ...signalList].sort(
    (a, b) => new Date(a.conversion_time || 0) - new Date(b.conversion_time || 0)
  );

  if (all.length === 0) {
    console.log('Bugün ve dün için dönüşüm bulunamadı.');
    return;
  }

  console.log('--- Dönüşüm listesi (tarih sırası) ---\n');
  console.log('  #  | Dönüşüm adı                        | Değer      | Kaynak  | Durum     | conversion_time');
  console.log('  ' + '-'.repeat(105));

  all.forEach((r, i) => {
    const timeStr = r.conversion_time ? new Date(r.conversion_time).toISOString().slice(0, 19).replace('T', ' ') : '';
    console.log('  ' + [String(i + 1).padStart(3), (r.donusum_adi || '').padEnd(34), centsToTry(r.tutar_cents, r.currency).padEnd(11), r.kaynak.padEnd(8), (r.status || '-').padEnd(10), timeStr].join(' | '));
  });

  console.log('\n--- Dönüşüm adına göre özet (ad + adet + toplam değer) ---\n');
  const byName = new Map();
  for (const r of all) {
    const ad = r.donusum_adi || '?';
    if (!byName.has(ad)) byName.set(ad, { count: 0, totalCents: 0, currency: r.currency || 'TRY' });
    const rec = byName.get(ad);
    rec.count += 1;
    rec.totalCents += r.tutar_cents || 0;
  }
  for (const [ad, rec] of byName.entries()) {
    console.log('  ' + ad + ': ' + rec.count + ' adet, toplam ' + centsToTry(rec.totalCents, rec.currency));
  }

  console.log('\n--- Toplam ---');
  console.log('  Kuyruk (V5): ' + queueList.length + ' dönüşüm');
  console.log('  Sinyal (V2–V4): ' + signalList.length + ' dönüşüm');
  console.log('  Toplam satır: ' + all.length);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
