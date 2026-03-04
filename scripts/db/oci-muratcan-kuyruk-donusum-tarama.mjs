#!/usr/bin/env node
/**
 * Muratcan — Dönüşüm bazlı kuyruk taraması.
 * Satış değil, dönüşüm adına göre: Script'e gidecek her şey (queue + sinyaller).
 * Kullanım: node scripts/db/oci-muratcan-kuyruk-donusum-tarama.mjs
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

const DONUSUM_ADI_V5 = 'OpsMantik_V5_DEMIR_MUHUR';

function centsToTry(cents, currency = 'TRY') {
  if (currency === 'TRY') return (Number(cents) / 100).toFixed(2) + ' TL';
  return (Number(cents) / 100).toFixed(2) + ' ' + currency;
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Muratcan AKÜ — Dönüşüm bazlı kuyruk taraması');
  console.log('  (Satış değil: dönüşüm adına göre — Script\'e gidecek liste)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1) offline_conversion_queue — Hepsi Demir Mühür (V5)
  const { data: queueRows, error: qErr } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, gclid, wbraid, gbraid, value_cents, currency, conversion_time, created_at')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads')
    .order('created_at', { ascending: true });

  if (qErr) {
    console.error('Kuyruk hatası:', qErr.message);
    process.exit(1);
  }

  const queueList = (queueRows || []).map((r) => ({
    kaynak: 'offline_conversion_queue',
    id: r.id,
    call_id: r.call_id,
    status: r.status,
    donusum_adi: DONUSUM_ADI_V5,
    tutar: r.value_cents ?? 0,
    currency: r.currency || 'TRY',
    conversion_time: r.conversion_time,
    gclid_kisa: (r.gclid || r.wbraid || r.gbraid || '').trim().slice(0, 28) + ((r.gclid || r.wbraid || r.gbraid || '').length > 28 ? '...' : ''),
  }));

  // 2) marketing_signals PENDING — V2, V3, V4 (Nitelikli Görüşme vb.)
  const { data: signalRows, error: sErr } = await supabase
    .from('marketing_signals')
    .select('id, call_id, signal_type, google_conversion_name, google_conversion_time, conversion_value, gclid, wbraid, gbraid, dispatch_status')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('dispatch_status', 'PENDING')
    .order('created_at', { ascending: true });

  if (sErr) {
    console.error('Sinyal hatası:', sErr.message);
    process.exit(1);
  }

  const signalList = (signalRows || []).map((r) => ({
    kaynak: 'marketing_signals',
    id: r.id,
    call_id: r.call_id,
    status: r.dispatch_status,
    donusum_adi: r.google_conversion_name || 'OpsMantik_Signal',
    tutar: (r.conversion_value != null ? Number(r.conversion_value) * 100 : 0),
    currency: 'TRY',
    conversion_time: r.google_conversion_time,
    gclid_kisa: (r.gclid || r.wbraid || r.gbraid || '').trim().slice(0, 28) + ((r.gclid || r.wbraid || r.gbraid || '').length > 28 ? '...' : ''),
  }));

  // 3) Dönüşüm adına göre grupla
  const byDonusum = new Map();
  for (const row of queueList) {
    const ad = row.donusum_adi;
    if (!byDonusum.has(ad)) byDonusum.set(ad, []);
    byDonusum.get(ad).push({ ...row, tutarCents: row.tutar });
  }
  for (const row of signalList) {
    const ad = row.donusum_adi;
    if (!byDonusum.has(ad)) byDonusum.set(ad, []);
    byDonusum.get(ad).push({ ...row, tutarCents: row.tutar });
  }

  console.log('--- 1) KUYRUK (offline_conversion_queue) — Sadece Demir Mühür (V5) ---');
  console.log('  Dönüşüm adı:', DONUSUM_ADI_V5);
  console.log('  Toplam satır:', queueList.length);
  if (queueList.length) {
    const byStatus = {};
    queueList.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
    console.log('  Durumlar:', JSON.stringify(byStatus));
    console.log('');
    console.log('  # | Dönüşüm adı | Tutar | Durum | conversion_time | GCLID (kısa)');
    console.log('  ' + '-'.repeat(95));
    queueList.forEach((r, i) => {
      console.log('  ' + [i + 1, r.donusum_adi, centsToTry(r.tutar, r.currency), r.status, (r.conversion_time || '').slice(0, 16), r.gclid_kisa].join(' | '));
    });
  }
  console.log('');

  console.log('--- 2) SİNYALLER (marketing_signals, PENDING) — Nitelikli Görüşme vb. (V2/V3/V4) ---');
  if (!signalList.length) {
    console.log('  PENDING sinyal yok.');
  } else {
    const byName = {};
    signalList.forEach((r) => { byName[r.donusum_adi] = (byName[r.donusum_adi] || 0) + 1; });
    console.log('  Dönüşüm adlarına göre:', JSON.stringify(byName, null, 2));
    console.log('');
    console.log('  # | Dönüşüm adı | Tutar | Durum | conversion_time | GCLID (kısa)');
    console.log('  ' + '-'.repeat(95));
    signalList.forEach((r, i) => {
      console.log('  ' + [i + 1, r.donusum_adi, centsToTry(r.tutar, r.currency), r.status, (r.conversion_time || '').slice(0, 16), r.gclid_kisa].join(' | '));
    });
  }
  console.log('');

  console.log('--- 3) DÖNÜŞÜM ADI ÖZETİ (Script\'e gidecek toplam) ---');
  for (const [donusumAdi, rows] of byDonusum.entries()) {
    const statusCount = {};
    rows.forEach((r) => { statusCount[r.status] = (statusCount[r.status] || 0) + 1; });
    console.log('  ' + donusumAdi + ': ' + rows.length + ' satır', statusCount);
  }
  console.log('');
  console.log('--- 4) V3 NEDEN 1000 TL GELİYORDU? (Düzeltildi) ---');
  console.log('  Floor: min_conversion_value_cents = 100000 (1000 TRY) hesaplanan değeri 1000\'e çekiyordu.');
  console.log('  Matematik: V3 = AOV × qualified(0.2) × decay(0.5) = 100 TRY. Düzeltme: oci-muratcan-v3-value-fix.mjs');
  console.log('  Yeni sinyaller için floor düşürüldü: migration 20260709000000_muratcan_signal_floor_50_try.sql (50 TRY).');
  console.log('');
  console.log('--- 5) TÜM DÖNÜŞÜMLERİ / INTENTLERİ KUYRUĞA ALMA ---');
  console.log('  Mühür (V5): node scripts/db/oci-enqueue.mjs Muratcan [--days 2]');
  console.log('  Sinyaller (V2–V4): marketing_signals\'a zaten yazılıyor (PENDING); Script export ile gider.');
  console.log('  Tarama: Bu script (oci-muratcan-kuyruk-donusum-tarama.mjs) dönüşüm adı bazlı özet verir.');
  console.log('');
  console.log('  Not: Kuyruk = sadece Demir Mühür (V5). Sinyaller = Nitelikli Görüşme vb. (V2–V4, satış değil).');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
