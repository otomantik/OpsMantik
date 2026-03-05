#!/usr/bin/env node
/**
 * Eslamed — Dün gece 22:40 (TRT) sonrası biriken dönüşümler.
 * Kuyrukta / PROCESSING'de ne var, nerede birikmiş?
 *
 *   node scripts/db/oci-eslamed-dun-2240-biriken.mjs
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

// Dün 22:40 TRT → ISO UTC. TRT = UTC+3, so "2026-03-04T22:40:00+03:00" = 19:40 UTC
function getSince2240TRT() {
  const now = new Date();
  const trtDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const [y, m, d] = trtDateStr.split('-').map(Number);
  const yesterday = new Date(y, m - 1, d - 1);
  const yStr = yesterday.getFullYear();
  const mStr = String(yesterday.getMonth() + 1).padStart(2, '0');
  const dStr = String(yesterday.getDate()).padStart(2, '0');
  const since = new Date(`${yStr}-${mStr}-${dStr}T22:40:00+03:00`);
  return since.toISOString();
}

function centsToTry(cents, currency = 'TRY') {
  if (cents == null) return '-';
  if ((currency || 'TRY').toUpperCase().replace(/[^A-Z]/g, '') === 'TRY') return (Number(cents) / 100).toFixed(2) + ' TRY';
  return (Number(cents) / 100).toFixed(2) + ' ' + (currency || '');
}

async function main() {
  const sinceIso = getSince2240TRT();
  console.log('\n  Eslamed — Dün gece 22:40 (TRT) sonrası biriken dönüşümler');
  console.log('  Başlangıç (UTC):', sinceIso);
  console.log('  Şimdi (UTC):    ', new Date().toISOString());
  console.log('');

  const { data: siteRow } = await supabase
    .from('sites')
    .select('id, name, public_id')
    .or('name.ilike.%Eslamed%,public_id.eq.81d957f3c7534f53b12ff305f9f07ae7')
    .limit(1)
    .single();
  if (!siteRow) {
    console.error('Eslamed site bulunamadı.');
    process.exit(1);
  }
  const siteId = siteRow.id;
  const siteName = siteRow.name || 'Eslamed';

  // ─── 0) Tüm kuyruk özet (son aktivite)
  const { count: totalCount } = await supabase
    .from('offline_conversion_queue')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads');
  const { data: allQueue } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, value_cents, currency, conversion_time, created_at, updated_at, last_error')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .order('updated_at', { ascending: false })
    .limit(200);
  const allQueueRows = allQueue || [];
  const byStatusAll = allQueueRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const processingRows = allQueueRows.filter((r) => r.status === 'PROCESSING');
  const queuedOrRetry = allQueueRows.filter((r) => r.status === 'QUEUED' || r.status === 'RETRY');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  0) ESLAMED TÜM KUYRUK ÖZET (V5)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Toplam kuyruk satırı (tüm zamanlar):', totalCount ?? 0);
  console.log('  Durum: QUEUED:', byStatusAll.QUEUED ?? 0, '| PROCESSING:', byStatusAll.PROCESSING ?? 0, '| COMPLETED:', byStatusAll.COMPLETED ?? 0, '| UPLOADED:', byStatusAll.UPLOADED ?? 0, '| FAILED:', byStatusAll.FAILED ?? 0, '| RETRY:', byStatusAll.RETRY ?? 0);
  if (allQueueRows.length > 0) {
    const last = allQueueRows[0];
    console.log('  Son güncelleme (en son satır):', last.updated_at ? new Date(last.updated_at).toISOString().slice(0, 19) : '-', '| status:', last.status);
  }
  if (processingRows.length > 0) {
    console.log('\n  PROCESSING\'de takılı (script ack göndermemiş olabilir):', processingRows.length);
    processingRows.forEach((r) => {
      const t = r.conversion_time ? new Date(r.conversion_time).toISOString().slice(0, 19) : '-';
      console.log('    id:', r.id?.slice(0, 8) + '...', '| conversion_time:', t, '| value:', centsToTry(r.value_cents, r.currency), '| updated:', r.updated_at?.slice(0, 19), r.last_error ? '| err: ' + r.last_error.slice(0, 60) : '');
    });
  }
  if (queuedOrRetry.length > 0) {
    console.log('\n  QUEUED/RETRY (sırada gönderilecek):', queuedOrRetry.length);
    queuedOrRetry.slice(0, 10).forEach((r) => {
      const t = r.conversion_time ? new Date(r.conversion_time).toISOString().slice(0, 19) : '-';
      console.log('    id:', r.id?.slice(0, 8) + '...', '|', r.status, '|', t, '|', centsToTry(r.value_cents, r.currency));
    });
    if (queuedOrRetry.length > 10) console.log('    ... ve', queuedOrRetry.length - 10, 'satır daha');
  }
  console.log('');

  // ─── 1) Kuyruk: conversion_time veya created_at >= since
  const { data: queueRows, error: qErr } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, value_cents, currency, conversion_time, created_at, updated_at, last_error, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .or('conversion_time.gte.' + sinceIso + ',created_at.gte.' + sinceIso);

  if (qErr) {
    console.error('Kuyruk hatası:', qErr.message);
    process.exit(1);
  }

  const queue = queueRows || [];
  const byStatus = queue.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  1) OFFLINE_CONVERSION_QUEUE (V5 Mühür) — 22:40 sonrası');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Durum dağılımı: QUEUED:', byStatus.QUEUED ?? 0, '| PROCESSING:', byStatus.PROCESSING ?? 0, '| COMPLETED:', byStatus.COMPLETED ?? 0, '| FAILED:', byStatus.FAILED ?? 0, '| RETRY:', byStatus.RETRY ?? 0);
  console.log('  Toplam satır:', queue.length);
  console.log('');

  if (queue.length > 0) {
    console.log('  queue_id (8)  | status     | değer       | conversion_time        | created_at');
    console.log('  ' + '-'.repeat(95));
    for (const r of queue.sort((a, b) => (a.conversion_time || a.created_at || '').localeCompare(b.conversion_time || b.created_at || ''))) {
      const ct = r.conversion_time ? new Date(r.conversion_time).toISOString().slice(0, 19).replace('T', ' ') : '-';
      const cr = r.created_at ? new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' ') : '-';
      console.log('  ' + [r.id?.slice(0, 8) + '...', (r.status || '').padEnd(11), centsToTry(r.value_cents, r.currency).padEnd(12), ct, cr].join(' | '));
    }
    const processing = queue.filter((r) => r.status === 'PROCESSING');
    if (processing.length > 0) {
      console.log('\n  PROCESSING\'de takılı (script/worker tamamlamamış):', processing.length);
      processing.forEach((r) => console.log('    ', r.id?.slice(0, 8) + '...', r.conversion_time || r.created_at, r.last_error || ''));
    }
    const queued = queue.filter((r) => r.status === 'QUEUED' || r.status === 'RETRY');
    if (queued.length > 0) {
      console.log('\n  QUEUED/RETRY (henüz gönderilmedi):', queued.length);
    }
  }
  console.log('');

  // ─── 2) Bugün/dün 22:40 sonrası mühürlenen call'lar (kuyruga girmesi gerekenler)
  const { data: sealedCalls } = await supabase
    .from('calls')
    .select('id, matched_session_id, confirmed_at, sale_amount, currency')
    .eq('site_id', siteId)
    .in('status', ['confirmed', 'qualified', 'real'])
    .eq('oci_status', 'sealed')
    .gte('confirmed_at', sinceIso)
    .order('confirmed_at', { ascending: true });

  const callIds = (sealedCalls || []).map((c) => c.id);
  const inQueueCallIds = new Set(queue.map((r) => r.call_id).filter(Boolean));
  const sealedNotInQueue = (sealedCalls || []).filter((c) => !inQueueCallIds.has(c.id));

  let sessionIds = [...new Set((sealedCalls || []).map((c) => c.matched_session_id).filter(Boolean))];
  const { data: sessions } = sessionIds.length
    ? await supabase.from('sessions').select('id, gclid, wbraid, gbraid').eq('site_id', siteId).in('id', sessionIds)
    : { data: [] };
  const sessionMap = new Map((sessions || []).map((s) => [s.id, s]));

  const withClickId = (sealedCalls || []).filter((c) => {
    const s = c.matched_session_id ? sessionMap.get(c.matched_session_id) : null;
    return !!(s?.gclid?.trim() || s?.wbraid?.trim() || s?.gbraid?.trim());
  });
  const withClickIdNotInQueue = withClickId.filter((c) => !inQueueCallIds.has(c.id));

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  2) MÜHÜRLENEN CALL\'LAR (22:40 sonrası sealed) — Kuyruga girmeli mi?');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Toplam sealed (22:40 sonrası):', (sealedCalls || []).length);
  console.log('  Click ID olan (gclid/wbraid/gbraid):', withClickId.length, '→ bunlar kuyruga girmeli');
  console.log('  Zaten kuyrukta olan (call_id eşleşen):', (sealedCalls || []).length - sealedNotInQueue.length);
  console.log('  Kuyrukta OLMAYAN (birikmiş olabilir):', sealedNotInQueue.length);
  if (withClickIdNotInQueue.length > 0) {
    console.log('  → Click ID\'li ama kuyrukta yok:', withClickIdNotInQueue.length, '(enqueue gerekebilir)');
    console.log('  call_id (8)   | confirmed_at          | sale_amount | currency');
    for (const c of withClickIdNotInQueue.slice(0, 20)) {
      const t = c.confirmed_at ? new Date(c.confirmed_at).toISOString().slice(0, 19).replace('T', ' ') : '-';
      console.log('  ' + [c.id?.slice(0, 8) + '...', t, String(c.sale_amount ?? '-').padEnd(11), c.currency || 'TRY'].join(' | '));
    }
    if (withClickIdNotInQueue.length > 20) console.log('  ... ve', withClickIdNotInQueue.length - 20, 'satır daha');
  }
  console.log('');

  // ─── 3) marketing_signals — PENDING (nabız V2/V3/V4) 22:40 sonrası
  const { data: signals } = await supabase
    .from('marketing_signals')
    .select('id, site_id, call_id, conversion_name, value_cents, currency, conversion_time, created_at, dispatch_status')
    .eq('site_id', siteId)
    .eq('dispatch_status', 'PENDING')
    .gte('conversion_time', sinceIso);

  const pendingSignals = signals || [];
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  3) MARKETING_SIGNALS (Nabız) — PENDING, 22:40 sonrası');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PENDING sayısı (henüz gönderilmedi):', pendingSignals.length);
  if (pendingSignals.length > 0) {
    console.log('  conversion_name              | değer       | conversion_time');
    for (const s of pendingSignals.slice(0, 25)) {
      const t = s.conversion_time ? new Date(s.conversion_time).toISOString().slice(0, 19).replace('T', ' ') : '-';
      console.log('  ' + [(s.conversion_name || '').slice(0, 28).padEnd(28), centsToTry(s.value_cents, s.currency).padEnd(12), t].join(' | '));
    }
    if (pendingSignals.length > 25) console.log('  ... ve', pendingSignals.length - 25, 'satır daha');
  }
  console.log('');

  console.log('  Özet: 22:40 sonrası kuyrukta', queue.length, 'satır (V5). PROCESSING:', byStatus.PROCESSING ?? 0, '| QUEUED/RETRY:', (byStatus.QUEUED ?? 0) + (byStatus.RETRY ?? 0), '| Nabız PENDING:', pendingSignals.length);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
