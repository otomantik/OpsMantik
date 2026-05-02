#!/usr/bin/env node
/**
 * Muratcan: Kuyruğa alınabilecek + kuyruktaki dönüşümler — GCLID, dönüşüm adı, tutar.
 * Kullanım: node scripts/db/oci-muratcan-kuyruk-rapor.mjs
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolveSiteId } from './lib/resolve-site-id.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

/** Won veya oci sealed legacy */
function sealedLike(call) {
  const st = (call.status ?? '').trim().toLowerCase();
  if (st === 'won') return true;
  if (!['confirmed', 'qualified', 'real'].includes(st)) return false;
  if (Object.prototype.hasOwnProperty.call(call, 'oci_status')) {
    return (call.oci_status ?? '').trim().toLowerCase() === 'sealed';
  }
  return true;
}

const WON_QUEUE_ACTION_LABEL = 'OpsMantik_Won';

function centsToTry(cents, currency = 'TRY') {
  if (currency === 'TRY') return (Number(cents) / 100).toFixed(2) + ' TL';
  return (Number(cents) / 100).toFixed(2) + ' ' + currency;
}

async function run() {
  const siteArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const siteId = await resolveSiteId(supabase, siteArg || 'muratcanaku');
  if (!siteId) {
    console.error('Site bulunamadı.');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Muratcan / site — Kuyruğa alınabilecek & kuyruktaki dönüşümler');
  console.log('  site_id:', siteId);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Site: default_aov, intent_weights (tutar matematiği)
  const { data: siteRow } = await supabase
    .from('sites')
    .select('default_aov, currency, intent_weights, min_conversion_value_cents')
    .eq('id', siteId)
    .maybeSingle();
  const defaultAov = siteRow?.default_aov ?? 500;
  const siteCurrency = siteRow?.currency || 'TRY';
  const intentWeights = siteRow?.intent_weights ?? { pending: 0.02, qualified: 0.2, proposal: 0.3, sealed: 1.0 };
  const minCents = siteRow?.min_conversion_value_cents ?? 100000;

  const { data: rawCalls } = await supabase
    .from('calls')
    .select('*')
    .eq('site_id', siteId)
    .in('status', ['won', 'confirmed', 'qualified', 'real']);
  const calls = (rawCalls || []).filter(sealedLike);

  const sessionIds = [...new Set((calls || []).map((c) => c.matched_session_id).filter(Boolean))];
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .in('id', sessionIds);

  const sessionMap = new Map((sessions || []).map((s) => [s.id, s]));

  // 2) Kuyrukta olan call_id'ler
  const { data: queueRows } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, gclid, wbraid, gbraid, value_cents, currency, conversion_time, created_at')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads');

  const queueByCallId = new Map((queueRows || []).map((r) => [r.call_id, r]));

  // 3) Kuyruğa alınabilecek: sealed + click ID var + kuyrukta yok
  const kuyrugaAlinabilecek = [];
  for (const c of calls || []) {
    const sess = c.matched_session_id ? sessionMap.get(c.matched_session_id) : null;
    const gclid = sess?.gclid ? String(sess.gclid).trim() : '';
    const wbraid = sess?.wbraid ? String(sess.wbraid).trim() : '';
    const gbraid = sess?.gbraid ? String(sess.gbraid).trim() : '';
    if (!gclid && !wbraid && !gbraid) continue;
    if (queueByCallId.has(c.id)) continue;
    const clickId = gclid || wbraid || gbraid;
    const valueCents = c.sale_amount != null && c.sale_amount > 0
      ? Math.round(Number(c.sale_amount) * 100)
      : Math.round(Number(defaultAov) * 100);
    kuyrugaAlinabilecek.push({
      call_id: c.id,
      confirmed_at: c.confirmed_at,
      gclid: gclid || null,
      wbraid: wbraid || null,
      gbraid: gbraid || null,
      clickIdShort: clickId.length > 24 ? clickId.slice(0, 24) + '...' : clickId,
      conversionName: WON_QUEUE_ACTION_LABEL,
      valueCents,
      currency: c.currency || siteCurrency,
    });
  }

  // 4) Zaten kuyrukta olanlar
  const kuyruktaOlan = (queueRows || []).map((r) => {
    const clickId = (r.gclid || r.wbraid || r.gbraid || '').trim();
    return {
      queue_id: r.id,
      call_id: r.call_id,
      status: r.status,
      gclid: r.gclid || null,
      wbraid: r.wbraid || null,
      gbraid: r.gbraid || null,
      clickIdShort: clickId.length > 24 ? clickId.slice(0, 24) + '...' : clickId,
      conversionName: WON_QUEUE_ACTION_LABEL,
      valueCents: r.value_cents ?? 0,
      currency: r.currency || siteCurrency,
      conversion_time: r.conversion_time,
      created_at: r.created_at,
    };
  });

  console.log('--- 1) KUYRUĞA ALINABİLECEK (sealed, GCLID var, henüz kuyrukta yok) ---');
  if (!kuyrugaAlinabilecek.length) {
    console.log('  Yok. Tüm GCLID\'li mühürler zaten kuyrukta veya GCLID yok.\n');
  } else {
    console.log('  Toplam:', kuyrugaAlinabilecek.length);
    console.log('');
    kuyrugaAlinabilecek.forEach((r, i) => {
      console.log(`  ${i + 1}. call_id: ${r.call_id?.slice(0, 8)}... | GCLID: ${r.clickIdShort}`);
      console.log(`     Dönüşüm adı: ${r.conversionName} | Tutar: ${centsToTry(r.valueCents, r.currency)} | Tarih: ${r.confirmed_at?.slice(0, 19) || '-'}`);
    });
    console.log('');
    console.log('  → Bunları kuyruğa almak için: node scripts/db/oci-enqueue.mjs <site_adı>');
    console.log('');
  }

  console.log('--- 2) KUYRUK TABLOSU (dönüşüm adı | tutar | durum | GCLID) ---');
  if (!kuyruktaOlan.length) {
    console.log('  Kuyrukta satır yok.\n');
  } else {
    const byStatus = {};
    kuyruktaOlan.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
    console.log('  Toplam:', kuyruktaOlan.length, '| Durumlar:', JSON.stringify(byStatus));
    console.log('');
    // Tablo başlığı
    console.log('  ' + ['#', 'Dönüşüm adı', 'Tutar', 'Durum', 'conversion_time', 'GCLID (kısa)'].join(' | '));
    console.log('  ' + '-'.repeat(100));
    kuyruktaOlan.forEach((r, i) => {
      const tutar = centsToTry(r.valueCents, r.currency);
      const time = (r.conversion_time || '').slice(0, 16);
      console.log('  ' + [i + 1, r.conversionName, tutar, r.status, time, r.clickIdShort].join(' | '));
    });
    console.log('');
  }

  console.log('--- 3) TUTAR MATEMATİĞİ ---');
  console.log('  Won / offline_conversion_queue (kanonik aksiyon OpsMantik_Won):');
  console.log('    Tutar = call.sale_amount > 0 ? sale_amount : default_aov');
  console.log('    Muratcan default_aov:', defaultAov, siteCurrency);
  console.log('');
  console.log('  V2–V4 (Sinyaller / marketing_signals):');
  console.log('    intent_weights (oran):', JSON.stringify(intentWeights));
  console.log('    pending %2, qualified %20, proposal %30, sealed %100 → AOV × oran × decay(gün)');
  console.log('    floor = max(min_conversion_value_cents, default_aov × 0.005 × 100)');
  console.log('    Muratcan min_conversion_value_cents:', minCents, '→', (minCents / 100).toFixed(0), 'TL min');
  console.log('');
  console.log('  Dönüşüm adları:');
    console.log('    Won kuyruk → OpsMantik_Won');
  console.log('    V3 sinyal → OpsMantik_V3_Nitelikli_Gorusme (sinyal değeri, satış değil)');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
