#!/usr/bin/env node
/**
 * Eslamed — Dün 22:00 (TRT) sonrası TÜM AKTİVİTE raporu.
 * Operatör ne yaptı (call_actions), hangi call'lar mühürlendi, kuyruk/sinyal nerede?
 * Hedef: Script tetiklenene kadar matematiğin doğru işlemesi, belirsizlik kalmaması.
 *
 *   node scripts/db/oci-eslamed-aktivite-rapor.mjs
 *   node scripts/db/oci-eslamed-aktivite-rapor.mjs --since 22   # dün 22:00 TRT (varsayılan)
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

const sinceHour = process.argv.find((a) => a.startsWith('--since=')) ? parseInt(process.argv.find((a) => a.startsWith('--since=')).split('=')[1], 10) : 22;

function getSinceTRT(hour) {
  const now = new Date();
  const trtDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const [y, m, d] = trtDateStr.split('-').map(Number);
  const yesterday = new Date(y, m - 1, d - 1);
  const yStr = yesterday.getFullYear();
  const mStr = String(yesterday.getMonth() + 1).padStart(2, '0');
  const dStr = String(yesterday.getDate()).padStart(2, '0');
  const since = new Date(`${yStr}-${mStr}-${dStr}T${String(hour).padStart(2, '0')}:00:00+03:00`);
  return since.toISOString();
}

function centsToTry(cents, currency = 'TRY') {
  if (cents == null) return '-';
  const c = (currency || 'TRY').toUpperCase().replace(/[^A-Z]/g, '') || 'TRY';
  return (Number(cents) / 100).toFixed(2) + ' ' + c;
}

function ts(s) {
  return s ? new Date(s).toISOString().slice(0, 19).replace('T', ' ') : '-';
}

async function main() {
  const sinceIso = getSinceTRT(sinceHour);
  console.log('\n══════════════════════════════════════════════════════════════════════════════');
  console.log('  ESLAMED — TAM AKTİVİTE RAPORU (dün ' + sinceHour + ':00 TRT sonrası)');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  Başlangıç (UTC):', sinceIso);
  console.log('  Şimdi (UTC):    ', new Date().toISOString());
  console.log('');

  const { data: siteRow } = await supabase
    .from('sites')
    .select('id, name')
    .or('name.ilike.%Eslamed%,public_id.eq.81d957f3c7534f53b12ff305f9f07ae7')
    .limit(1)
    .single();
  if (!siteRow) {
    console.error('Eslamed site bulunamadı.');
    process.exit(1);
  }
  const siteId = siteRow.id;

  // ─── 1) CALL_ACTIONS — Operatör / sistem ne yaptı (zaman sırası)
  const { data: actions } = await supabase
    .from('call_actions')
    .select('id, call_id, action_type, actor_type, actor_id, previous_status, new_status, created_at')
    .eq('site_id', siteId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });

  console.log('--- 1) OPERATÖR / SİSTEM AKTİVİTESİ (call_actions) ---');
  console.log('  Toplam:', (actions || []).length, 'aksiyon');
  if ((actions || []).length > 0) {
    console.log('  created_at          | action_type   | call_id (8)  | prev → new     | actor');
    console.log('  ' + '-'.repeat(85));
    for (const a of actions) {
      const act = (a.action_type || '').slice(0, 12).padEnd(12);
      const callShort = (a.call_id || '').toString().slice(0, 8) + '...';
      const trans = (a.previous_status || '-') + ' → ' + (a.new_status || '-');
      const actor = a.actor_type === 'user' ? (a.actor_id || '').toString().slice(0, 8) + '...' : a.actor_type || '-';
      console.log('  ' + [ts(a.created_at), act, callShort, trans.padEnd(14), actor].join(' | '));
    }
  }
  console.log('');

  // ─── 2) CALLS — Mühürlenen / confirmed (22:00 sonrası)
  const { data: sealedCalls } = await supabase
    .from('calls')
    .select('id, matched_session_id, status, oci_status, confirmed_at, sale_amount, currency, created_at')
    .eq('site_id', siteId)
    .in('status', ['confirmed', 'qualified', 'real'])
    .eq('oci_status', 'sealed')
    .gte('confirmed_at', sinceIso)
    .order('confirmed_at', { ascending: true });

  console.log('--- 2) MÜHÜRLENEN CALL\'LAR (confirmed_at >= dün ' + sinceHour + ':00 TRT) ---');
  console.log('  Toplam:', (sealedCalls || []).length);
  if ((sealedCalls || []).length > 0) {
    console.log('  confirmed_at        | call_id (8)   | sale_amount | currency');
    console.log('  ' + '-'.repeat(65));
    for (const c of sealedCalls) {
      console.log('  ' + [ts(c.confirmed_at), (c.id || '').slice(0, 8) + '...', String(c.sale_amount ?? '-').padEnd(11), c.currency || 'TRY'].join(' | '));
    }
  }
  console.log('');

  // ─── 3) KUYRUK — Tüm satırlar (conversion_time veya created_at veya updated_at >= since)
  const { data: queueRows } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, value_cents, currency, conversion_time, created_at, updated_at, last_error')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads');

  const queue = queueRows || [];
  const queueInWindow = queue.filter((r) => {
    const t = r.conversion_time || r.created_at || r.updated_at;
    return t && new Date(t) >= new Date(sinceIso);
  });
  const byStatus = queueInWindow.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const processingAll = queue.filter((r) => r.status === 'PROCESSING');
  const uploadedAll = queue.filter((r) => r.status === 'UPLOADED');

  console.log('--- 3) KUYRUK (offline_conversion_queue) — 22:00 sonrası ilgili satırlar ---');
  console.log('  Pencere içi satır:', queueInWindow.length, '| Durum dağılımı:', byStatus);
  console.log('  Tüm kuyrukta PROCESSING:', processingAll.length, '| UPLOADED:', uploadedAll.length);
  if (processingAll.length > 0) {
    console.log('\n  PROCESSING\'de takılı (ack gitmemiş veya script 404 almış):');
    for (const r of processingAll) {
      console.log('    id:', r.id, '| conversion_time:', ts(r.conversion_time), '| value:', centsToTry(r.value_cents, r.currency), '| updated:', ts(r.updated_at), r.last_error ? '| err: ' + (r.last_error || '').slice(0, 50) : '');
    }
  }
  if (queueInWindow.length > 0) {
    console.log('\n  Pencere içi kuyruk satırları (zaman sırası):');
    console.log('  conversion_time     | status     | value       | queue_id (8)  | created_at');
    console.log('  ' + '-'.repeat(95));
    for (const r of queueInWindow.sort((a, b) => (a.conversion_time || a.created_at || '').localeCompare(b.conversion_time || b.created_at || ''))) {
      console.log('  ' + [ts(r.conversion_time), (r.status || '').padEnd(11), centsToTry(r.value_cents, r.currency).padEnd(12), (r.id || '').slice(0, 8) + '...', ts(r.created_at)].join(' | '));
    }
  }
  console.log('');

  // ─── 4) MARKETING_SIGNALS (Nabız) — 22:00 sonrası
  const { data: signals } = await supabase
    .from('marketing_signals')
    .select('id, call_id, conversion_name, value_cents, currency, conversion_time, created_at, dispatch_status')
    .eq('site_id', siteId)
    .gte('conversion_time', sinceIso)
    .order('conversion_time', { ascending: true });

  const pendingSignals = (signals || []).filter((s) => s.dispatch_status === 'PENDING');
  console.log('--- 4) NABIZ (marketing_signals) — 22:00 sonrası ---');
  console.log('  Toplam sinyal:', (signals || []).length, '| PENDING (henüz gönderilmedi):', pendingSignals.length);
  if ((signals || []).length > 0) {
    console.log('  conversion_time     | conversion_name              | dispatch_status | value');
    console.log('  ' + '-'.repeat(95));
    for (const s of signals.slice(0, 30)) {
      console.log('  ' + [ts(s.conversion_time), (s.conversion_name || '').slice(0, 28).padEnd(28), (s.dispatch_status || '').padEnd(16), centsToTry(s.value_cents, s.currency)].join(' | '));
    }
    if (signals.length > 30) console.log('  ... ve', signals.length - 30, 'satır daha');
  }
  console.log('');

  // ─── Özet + PROCESSING düzeltme notu
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  ÖZET');
  console.log('  - Operatör aksiyon:', (actions || []).length, '| Mühürlenen call:', (sealedCalls || []).length);
  console.log('  - Kuyruk (pencere):', queueInWindow.length, '| PROCESSING\'de takılı:', processingAll.length);
  console.log('  - Nabız PENDING:', pendingSignals.length);
  if (processingAll.length > 0) {
    console.log('\n  PROCESSING takılı satır Google\'a gittiyse: POST /api/oci/ack ile seal_<queue_id> göndererek UPLOADED yapılabilir.');
    console.log('  Örnek: curl.exe -X POST "' + (process.env.NEXT_PUBLIC_APP_URL || 'https://console.opsmantik.com') + '/api/oci/ack" -H "x-api-key: KEY" -H "Content-Type: application/json" -d "{\\"siteId\\":\\"81d957f3c7534f53b12ff305f9f07ae7\\",\\"queueIds\\":[\\"seal_' + (processingAll[0]?.id || '') + '\\"],\\"pendingConfirmation\\":true}"');
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
