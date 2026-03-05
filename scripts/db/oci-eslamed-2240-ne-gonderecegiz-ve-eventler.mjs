#!/usr/bin/env node
/**
 * Eslamed — Gece 22:40 (TRT) sonrası:
 * 1) NE GÖNDERECEĞİZ: Script çalışsaydı export'tan dönecek liste (kuyruk QUEUED/RETRY + nabız PENDING).
 * 2) HANGİ EVENTLER TETİKLENMİŞ: call_actions, mühürlenen call'lar, marketing_signals (zaman sırası).
 *
 *   node scripts/db/oci-eslamed-2240-ne-gonderecegiz-ve-eventler.mjs
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
  const c = (currency || 'TRY').toUpperCase().replace(/[^A-Z]/g, '') || 'TRY';
  return (Number(cents) / 100).toFixed(2) + ' ' + c;
}

function ts(s) {
  return s ? new Date(s).toISOString().slice(0, 19).replace('T', ' ') : '-';
}

async function main() {
  const sinceIso = getSince2240TRT();
  console.log('\n══════════════════════════════════════════════════════════════════════════════');
  console.log('  ESLAMED — GECE 22:40 (TRT) SONRASI: NE GÖNDERECEĞİZ + HANGİ EVENTLER TETİKLENDİ');
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

  // ═══════════════════════════════════════════════════════════════
  // BÖLÜM A: NE GÖNDERECEĞİZ (script çalışsaydı export'tan dönecekler)
  // ═══════════════════════════════════════════════════════════════
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  A) NE GÖNDERECEĞİZ (Script çalışsaydı Google Ads\'e gidecek satırlar)');
  console.log('══════════════════════════════════════════════════════════════════════════════\n');

  // Kuyruk: QUEUED veya RETRY (script export bunları alır)
  const { data: queueRows } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, value_cents, currency, conversion_time, created_at, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .in('status', ['QUEUED', 'RETRY']);

  // Nabız: PENDING (export bunları da döner)
  const { data: pendingSignals } = await supabase
    .from('marketing_signals')
    .select('id, call_id, conversion_name, value_cents, currency, conversion_time, created_at')
    .eq('site_id', siteId)
    .eq('dispatch_status', 'PENDING');

  const kuyruk = queueRows || [];
  const nabiz = pendingSignals || [];
  const toplamGonderilecek = kuyruk.length + nabiz.length;

  if (toplamGonderilecek === 0) {
    console.log('  22:40 sonrası gönderilecek satır YOK.');
    console.log('  - Kuyruk (QUEUED/RETRY):', kuyruk.length);
    console.log('  - Nabız (PENDING):', nabiz.length);
  } else {
    const rows = [
      ...kuyruk.map((r) => ({
        kaynak: 'kuyruk',
        id: r.id,
        conversionName: 'OpsMantik_V5_DEMIR_MUHUR',
        valueCents: r.value_cents,
        currency: r.currency,
        conversionTime: r.conversion_time,
        gclid: r.gclid,
        wbraid: r.wbraid,
        gbraid: r.gbraid,
      })),
      ...nabiz.map((r) => ({
        kaynak: 'nabız',
        id: r.id,
        conversionName: r.conversion_name || '',
        valueCents: r.value_cents,
        currency: r.currency,
        conversionTime: r.conversion_time,
        gclid: null,
        wbraid: null,
        gbraid: null,
      })),
    ].sort((a, b) => (a.conversionTime || a.id || '').localeCompare(b.conversionTime || b.id || ''));

    console.log('  #  | Kaynak  | Dönüşüm adı                        | Değer       | conversion_time     | gclid | wbraid | gbraid');
    console.log('  ' + '-'.repeat(115));
    rows.forEach((r, i) => {
      const name = (r.conversionName || '').slice(0, 38).padEnd(38);
      const val = centsToTry(r.valueCents, r.currency).padEnd(12);
      const ct = ts(r.conversionTime);
      const g = r.gclid ? 'var' : '-';
      const w = r.wbraid ? 'var' : '-';
      const b = r.gbraid ? 'var' : '-';
      console.log('  ' + [String(i + 1).padStart(3), r.kaynak.padEnd(7), name, val, ct, g.padEnd(5), w.padEnd(6), b].join(' | '));
    });
    console.log('  ' + '-'.repeat(115));
    console.log('  Toplam gönderilecek:', rows.length, '(kuyruk:', kuyruk.length, '| nabız:', nabiz.length, ')');
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // BÖLÜM B: HANGİ EVENTLER TETİKLENMİŞ (22:40 sonrası, zaman sırası)
  // ═══════════════════════════════════════════════════════════════
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  B) HANGİ EVENTLER TETİKLENMİŞ (22:40 TRT sonrası)');
  console.log('══════════════════════════════════════════════════════════════════════════════\n');

  // B1) call_actions — operatör/sistem aksiyonları
  const { data: actions } = await supabase
    .from('call_actions')
    .select('id, call_id, action_type, actor_type, previous_status, new_status, created_at')
    .eq('site_id', siteId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });

  console.log('  B1) CALL_ACTIONS (operatör/sistem aksiyonları)');
  console.log('  Toplam:', (actions || []).length);
  if ((actions || []).length > 0) {
    console.log('  created_at          | action_type   | call_id (8)  | prev → new');
    console.log('  ' + '-'.repeat(70));
    for (const a of actions) {
      const trans = (a.previous_status || '-') + ' → ' + (a.new_status || '-');
      console.log('  ' + [ts(a.created_at), (a.action_type || '').padEnd(13), (a.call_id || '').toString().slice(0, 8) + '...', trans].join(' | '));
    }
  }
  console.log('');

  // B2) Calls — 22:40 sonrası mühürlenen (confirmed_at) veya güncellenen
  const { data: sealedCalls } = await supabase
    .from('calls')
    .select('id, matched_session_id, status, oci_status, confirmed_at, sale_amount, currency, created_at, updated_at')
    .eq('site_id', siteId)
    .in('status', ['confirmed', 'qualified', 'real'])
    .eq('oci_status', 'sealed')
    .gte('confirmed_at', sinceIso)
    .order('confirmed_at', { ascending: true });

  const { data: updatedCalls } = await supabase
    .from('calls')
    .select('id, status, oci_status, confirmed_at, updated_at')
    .eq('site_id', siteId)
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: true });

  console.log('  B2) CALLS — 22:40 sonrası mühürlenen (confirmed_at >= 22:40)');
  console.log('  Toplam sealed:', (sealedCalls || []).length);
  if ((sealedCalls || []).length > 0) {
    for (const c of sealedCalls) {
      console.log('    call_id:', c.id?.slice(0, 8) + '...', '| confirmed_at:', ts(c.confirmed_at), '| sale:', c.sale_amount, c.currency);
    }
  }

  console.log('\n  B2b) CALLS — 22:40 sonrası güncellenen (updated_at >= 22:40)');
  console.log('  Toplam:', (updatedCalls || []).length);
  if ((updatedCalls || []).length > 0) {
    for (const c of updatedCalls.slice(0, 20)) {
      console.log('    call_id:', c.id?.slice(0, 8) + '...', '| status:', c.status, '| oci_status:', c.oci_status, '| updated_at:', ts(c.updated_at));
    }
    if (updatedCalls.length > 20) console.log('    ... ve', updatedCalls.length - 20, 'satır daha');
  }
  console.log('');

  // B3) marketing_signals — 22:40 sonrası oluşturulan veya conversion_time 22:40 sonrası
  const { data: signalsCreated } = await supabase
    .from('marketing_signals')
    .select('id, call_id, conversion_name, value_cents, currency, conversion_time, created_at, dispatch_status')
    .eq('site_id', siteId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });

  const { data: signalsConvTime } = await supabase
    .from('marketing_signals')
    .select('id, call_id, conversion_name, value_cents, currency, conversion_time, created_at, dispatch_status')
    .eq('site_id', siteId)
    .gte('conversion_time', sinceIso)
    .order('conversion_time', { ascending: true });

  const signalIds = new Set([...(signalsCreated || []).map((s) => s.id), ...(signalsConvTime || []).map((s) => s.id)]);
  const signalsAll = [...(signalsCreated || []), ...(signalsConvTime || [])].filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i);
  signalsAll.sort((a, b) => (a.created_at || a.conversion_time || '').localeCompare(b.created_at || b.conversion_time || ''));

  console.log('  B3) MARKETING_SIGNALS — 22:40 sonrası (created_at veya conversion_time)');
  console.log('  Toplam:', signalsAll.length);
  if (signalsAll.length > 0) {
    console.log('  conversion_time     | created_at     | conversion_name              | dispatch  | value');
    console.log('  ' + '-'.repeat(100));
    for (const s of signalsAll.slice(0, 30)) {
      console.log('  ' + [ts(s.conversion_time), ts(s.created_at), (s.conversion_name || '').slice(0, 28).padEnd(28), (s.dispatch_status || '').padEnd(9), centsToTry(s.value_cents, s.currency)].join(' | '));
    }
    if (signalsAll.length > 30) console.log('  ... ve', signalsAll.length - 30, 'satır daha');
  }
  console.log('');

  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  ÖZET: Gönderilecek', toplamGonderilecek, '| call_actions', (actions || []).length, '| sealed calls', (sealedCalls || []).length, '| signals', signalsAll.length);
  console.log('══════════════════════════════════════════════════════════════════════════════\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
