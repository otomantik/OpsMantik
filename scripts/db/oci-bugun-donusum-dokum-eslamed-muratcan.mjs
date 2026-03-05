#!/usr/bin/env node
/**
 * Eslamed + Muratcan — Bugünkü dönüşüm durumu dökümü.
 * - Kuyruga gitmesi gerekenler (bugün mühürlenen, click_id'li) gitmiş mi?
 * - offline_conversion_queue: bugün conversion_time / bugün oluşan — durum (QUEUED/COMPLETED/FAILED)
 * - Script çalışırsa Google Ads'e hangi değerlerle gidecek? (gclid, value TRY, conversion_time)
 *
 * Kullanım:
 *   node scripts/db/oci-bugun-donusum-dokum-eslamed-muratcan.mjs     # varsayilan: bugün TRT
 *   node scripts/db/oci-bugun-donusum-dokum-eslamed-muratcan.mjs --utc    # bugün UTC
 *   node scripts/db/oci-bugun-donusum-dokum-eslamed-muratcan.mjs --days 7 # son 7 gün (TRT)
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
const useUTC = process.argv.includes('--utc');
const useTRT = !useUTC; // varsayilan: TRT (Turkiye bugunu)
const daysArg = process.argv.find((a) => a.startsWith('--days=')) || (process.argv.includes('--days') ? process.argv[process.argv.indexOf('--days') + 1] : null);
const lastNDays = daysArg != null ? parseInt(String(daysArg).replace('--days=', ''), 10) : 0;

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
  if (currency === 'TRY') return (Number(cents) / 100).toFixed(2) + ' TRY';
  return (Number(cents) / 100).toFixed(2) + ' ' + currency;
}

function getTodayRange() {
  const now = new Date();
  let start;
  let label;
  if (lastNDays >= 1) {
    if (useTRT) {
      const trt = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
      start = new Date(Date.UTC(trt.getFullYear(), trt.getMonth(), trt.getDate(), 0, 0, 0, 0));
      start.setUTCHours(start.getUTCHours() - 3);
    } else {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    }
    const from = new Date(start);
    from.setUTCDate(from.getUTCDate() - (lastNDays - 1));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { fromIso: from.toISOString(), toIso: end.toISOString(), label: 'son ' + lastNDays + ' gün' };
  }
  if (useTRT) {
    const trt = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
    start = new Date(Date.UTC(trt.getFullYear(), trt.getMonth(), trt.getDate(), 0, 0, 0, 0));
    start.setUTCHours(start.getUTCHours() - 3);
    label = 'TRT bugün';
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    label = 'UTC bugün';
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { fromIso: start.toISOString(), toIso: end.toISOString(), label };
}

async function runSite(siteName, siteId) {
  const { fromIso, toIso, label } = getTodayRange();
  const dayLabel = fromIso.slice(0, 10);

  const { data: siteRow } = await supabase.from('sites').select('name, currency, default_aov').eq('id', siteId).maybeSingle();
  const name = siteRow?.name || siteName;
  const currency = (siteRow?.currency || 'TRY').trim().toUpperCase().replace(/[^A-Z]/g, '') || 'TRY';

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ' + name + ' — Dönüşüm dökümü (' + label + ' ' + dayLabel + ')');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ─── 0) Tüm zamanlar kontrol (veri var mi, hangi tarihler?)
  const { data: allSealed } = await supabase
    .from('calls')
    .select('id, confirmed_at, sale_amount, currency')
    .eq('site_id', siteId)
    .in('status', ['confirmed', 'qualified', 'real'])
    .eq('oci_status', 'sealed')
    .order('confirmed_at', { ascending: false })
    .limit(10);
  const { count: totalSealed } = await supabase
    .from('calls')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .in('status', ['confirmed', 'qualified', 'real'])
    .eq('oci_status', 'sealed');
  const { data: allQueue } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, value_cents, currency, conversion_time, created_at')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .order('conversion_time', { ascending: false })
    .limit(10);
  const { count: totalQueue } = await supabase
    .from('offline_conversion_queue')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads');

  console.log('--- 0) TÜM ZAMANLAR KONTROL (veri var mi?) ---');
  console.log('  Toplam sealed (mühürlü) call:', totalSealed ?? 0);
  console.log('  Toplam kuyruk satırı (google_ads):', totalQueue ?? 0);
  if ((allSealed || []).length > 0) {
    console.log('  Son sealed confirmed_at (en yeni 5):');
    (allSealed || []).slice(0, 5).forEach((c) => {
      const t = c.confirmed_at ? new Date(c.confirmed_at).toISOString().slice(0, 16) : '-';
      const val = c.sale_amount != null ? String(c.sale_amount) + ' ' + (c.currency || 'TRY') : '-';
      console.log('    ' + t + ' | ' + val);
    });
  }
  if ((allQueue || []).length > 0) {
    console.log('  Son kuyruk conversion_time (en yeni 5):');
    (allQueue || []).slice(0, 5).forEach((r) => {
      const t = r.conversion_time ? new Date(r.conversion_time).toISOString().slice(0, 16) : '-';
      console.log('    ' + t + ' | ' + (r.status || '') + ' | ' + centsToTry(r.value_cents, r.currency));
    });
  }
  console.log('');

  // ─── 1) Bugün mühürlenen call'lar (kuyruga gitmesi gerekenler)
  const { data: sealedCalls, error: callsErr } = await supabase
    .from('calls')
    .select('id, matched_session_id, confirmed_at, lead_score, sale_amount, currency')
    .eq('site_id', siteId)
    .in('status', ['confirmed', 'qualified', 'real'])
    .eq('oci_status', 'sealed')
    .gte('confirmed_at', fromIso)
    .lt('confirmed_at', toIso)
    .order('confirmed_at', { ascending: true });

  if (callsErr) {
    console.error('Calls hatasi:', callsErr.message);
    return;
  }

  const sessionIds = [...new Set((sealedCalls || []).map((c) => c.matched_session_id).filter(Boolean))];
  const { data: sessions } = sessionIds.length
    ? await supabase.from('sessions').select('id, gclid, wbraid, gbraid').eq('site_id', siteId).in('id', sessionIds)
    : { data: [] };
  const sessionMap = new Map((sessions || []).map((s) => [s.id, s]));

  const withClickId = (sealedCalls || []).filter((c) => {
    const s = c.matched_session_id ? sessionMap.get(c.matched_session_id) : null;
    const g = s?.gclid && String(s.gclid).trim();
    const w = s?.wbraid && String(s.wbraid).trim();
    const b = s?.gbraid && String(s.gbraid).trim();
    return !!(g || w || b);
  });

  console.log('--- 1) BUGÜN MÜHÜRLENEN (kuyruga gitmesi gerekenler) ---');
  console.log('  Toplam sealed (bugün confirmed_at):', (sealedCalls || []).length);
  console.log('  Click ID var (gclid/wbraid/gbraid):', withClickId.length, '→ bunlar kuyruga girmeli\n');

  if ((sealedCalls || []).length > 0) {
    console.log('  call_id (kısa)  | confirmed_at       | lead_score | sale_amount | click_id');
    console.log('  ' + '-'.repeat(85));
    for (const c of sealedCalls) {
      const s = c.matched_session_id ? sessionMap.get(c.matched_session_id) : null;
      const hasG = s?.gclid && String(s.gclid).trim();
      const hasW = s?.wbraid && String(s.wbraid).trim();
      const hasB = s?.gbraid && String(s.gbraid).trim();
      const click = hasG ? 'gclid' : hasW ? 'wbraid' : hasB ? 'gbraid' : 'YOK';
      const timeStr = c.confirmed_at ? new Date(c.confirmed_at).toISOString().slice(0, 19).replace('T', ' ') : '';
      console.log('  ' + [c.id?.slice(0, 8) + '...', timeStr, String(c.lead_score ?? '-').padEnd(10), String(c.sale_amount ?? '-').padEnd(12), click].join(' | '));
    }
    console.log('');
  }

  // ─── 2) Kuyruk: bugün conversion_time veya bugün created
  const { data: queueRows, error: qErr } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, value_cents, currency, conversion_time, gclid, wbraid, gbraid, uploaded_at, last_error, created_at')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads');

  if (qErr) {
    console.error('Kuyruk hatasi:', qErr.message);
    return;
  }

  const queueAll = queueRows || [];
  const queueTodayByTime = queueAll.filter((r) => {
    const t = r.conversion_time ? new Date(r.conversion_time).getTime() : 0;
    return t >= new Date(fromIso).getTime() && t < new Date(toIso).getTime();
  });
  const queueTodayCreated = queueAll.filter((r) => {
    const t = r.created_at ? new Date(r.created_at).getTime() : 0;
    return t >= new Date(fromIso).getTime() && t < new Date(toIso).getTime();
  });
  const queueToday = [...new Map([...queueTodayByTime, ...queueTodayCreated].map((r) => [r.id, r])).values()];

  const byStatus = queueToday.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log('--- 2) KUYRUK (bugün conversion_time veya bugün oluşan) ---');
  console.log('  QUEUED:', byStatus.QUEUED ?? 0, '| COMPLETED:', byStatus.COMPLETED ?? 0, '| FAILED:', byStatus.FAILED ?? 0, '| RETRY:', byStatus.RETRY ?? 0, '| PROCESSING:', byStatus.PROCESSING ?? 0);
  console.log('  Toplam satır (bugünle ilgili):', queueToday.length, '\n');

  if (queueToday.length > 0) {
    console.log('  queue_id   | call_id   | status     | değer      | conversion_time       | gclid/wbraid/gbraid');
    console.log('  ' + '-'.repeat(95));
    for (const r of queueToday.sort((a, b) => (a.conversion_time || '').localeCompare(b.conversion_time || ''))) {
      const timeStr = r.conversion_time ? new Date(r.conversion_time).toISOString().slice(0, 19).replace('T', ' ') : '-';
      const click = [r.gclid ? 'gclid' : '', r.wbraid ? 'wbraid' : '', r.gbraid ? 'gbraid' : ''].filter(Boolean).join(',') || 'YOK';
      console.log('  ' + [r.id?.slice(0, 8) + '...', (r.call_id || '').slice(0, 8) + '...', (r.status || '').padEnd(11), centsToTry(r.value_cents, r.currency).padEnd(11), timeStr, click].join(' | '));
    }
    console.log('');
  }

  // ─── 3) Nabız: işlenmiş mi?
  const completed = queueToday.filter((r) => (r.status === 'COMPLETED' || r.status === 'UPLOADED') && (r.uploaded_at || r.status === 'UPLOADED'));
  const failed = queueToday.filter((r) => r.status === 'FAILED');
  const queued = queueToday.filter((r) => r.status === 'QUEUED' || r.status === 'RETRY' || r.status === 'PROCESSING');

  console.log('--- 3) NABIZ ÖZET ---');
  console.log('  Kuyruga gitmesi gereken (sealed + click_id):', withClickId.length);
  console.log('  Kuyrukta bugünle ilgili satır:              ', queueToday.length);
  console.log('  İşlenmiş (UPLOADED/COMPLETED):              ', completed.length);
  console.log('  Bekliyor (QUEUED/RETRY/PROCESSING):         ', queued.length);
  console.log('  Hata (FAILED):                              ', failed.length);
  if (failed.length > 0) {
    console.log('\n  FAILED last_error örnek:', failed[0]?.last_error?.slice(0, 80) || '-');
  }
  console.log('');

  // ─── 4) Tüm dönüşümler (mühür V5 + nabız V2/V3/V4) — script çalışırsa Google Ads'e gidecekler
  const V5_NAME = 'OpsMantik_V5_DEMIR_MUHUR';
  const queueWouldSend = queueToday.filter((r) => ['QUEUED', 'RETRY', 'PROCESSING'].includes(r.status) && (r.gclid || r.wbraid || r.gbraid));

  const { data: signalPending } = await supabase
    .from('marketing_signals')
    .select('id, google_conversion_name, google_conversion_time, conversion_value, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .eq('dispatch_status', 'PENDING')
    .gte('google_conversion_time', fromIso)
    .lt('google_conversion_time', toIso)
    .order('google_conversion_time', { ascending: true });

  const signalWouldSend = (signalPending || []).filter((s) => (s.gclid && String(s.gclid).trim()) || (s.wbraid && String(s.wbraid).trim()) || (s.gbraid && String(s.gbraid).trim()));

  const allRows = [
    ...queueWouldSend.map((r) => ({
      conversionName: V5_NAME,
      conversionTime: r.conversion_time,
      valueDisplay: centsToTry(r.value_cents, r.currency),
      valueCents: Number(r.value_cents) || 0,
      gclid: r.gclid,
      wbraid: r.wbraid,
      gbraid: r.gbraid,
      kaynak: 'kuyruk',
    })),
    ...signalWouldSend.map((s) => {
      const val = s.conversion_value != null ? Number(s.conversion_value) : 0;
      const display = Number.isFinite(val) ? val.toFixed(2) + ' TRY' : '-';
      const valueCents = Math.round(val * 100);
      return {
        conversionName: s.google_conversion_name || 'OpsMantik_Signal',
        conversionTime: s.google_conversion_time,
        valueDisplay: display,
        valueCents,
        gclid: s.gclid,
        wbraid: s.wbraid,
        gbraid: s.gbraid,
        kaynak: 'nabız',
      };
    }),
  ].sort((a, b) => (a.conversionTime || '').localeCompare(b.conversionTime || ''));

  console.log('--- 4) TÜM DÖNÜŞÜMLER — SCRIPT ÇALIŞIRSA GOOGLE ADS\'E GİDECEKLER (Mühür V5 + Nabız V2/V3/V4) ---');
  console.log('  Kuyruk (mühür): ' + V5_NAME);
  console.log('  Nabız: OpsMantik_V2_Ilk_Temas, V3_Nitelikli_Gorusme, V4_Sicak_Teklif (PENDING sinyaller)\n');
  if (allRows.length === 0) {
    console.log('  Gönderilecek satır yok. (Kuyruk: db:enqueue. Nabız: sinyal pipeline PENDING olanlar.)\n');
  } else {
    console.log('  #   | Dönüşüm adı                        | Değer        | conversion_time       | kaynak  | gclid | wbraid | gbraid');
    console.log('  ' + '-'.repeat(110));
    allRows.forEach((r, i) => {
      const timeStr = r.conversionTime ? new Date(r.conversionTime).toISOString().slice(0, 19).replace('T', ' ') : '-';
      const valPad = (r.valueDisplay || '').padEnd(12);
      const namePad = (r.conversionName || '').padEnd(30);
      console.log('  ' + [String(i + 1).padStart(3), namePad, valPad, timeStr, (r.kaynak || '').padEnd(7), r.gclid ? 'var' : '-', r.wbraid ? 'var' : '-', r.gbraid ? 'var' : '-'].join(' | '));
    });
    const toplamCents = allRows.reduce((s, r) => s + (r.valueCents || 0), 0);
    const kuyrukN = allRows.filter((r) => r.kaynak === 'kuyruk').length;
    const nabizN = allRows.filter((r) => r.kaynak === 'nabız').length;
    console.log('  ' + '-'.repeat(110));
    console.log('  Toplam: ' + allRows.length + ' dönüşüm (kuyruk: ' + kuyrukN + ', nabız: ' + nabizN + '), toplam değer: ' + centsToTry(toplamCents, currency) + '\n');
  }
}

async function run() {
  const siteIds = [];
  for (const name of ['Eslamed', 'Muratcan']) {
    const id = await resolveSiteId(name);
    if (id) siteIds.push({ name, id });
    else console.warn('Site bulunamadi:', name);
  }
  if (siteIds.length === 0) {
    console.error('Hic site bulunamadi (Eslamed, Muratcan).');
    process.exit(1);
  }

  const range = getTodayRange();
  console.log('\n  OCI Dönüşüm Dökümü — Eslamed & Muratcan');
  console.log('  Tarih aralığı: ' + range.label + ' ' + range.fromIso.slice(0, 10) + ' .. ' + range.toIso.slice(0, 10));
  if (!lastNDays && useTRT) console.log('  (Varsayılan: TRT bugün; --utc ile UTC bugün)');
  if (lastNDays) console.log('  (--days ' + lastNDays + ': son ' + lastNDays + ' gün)');

  for (const { name, id } of siteIds) {
    await runSite(name, id);
  }
  console.log('\n  Bitti. Kuyruk eklemek için: npm run db:enqueue:today (Eslamed) veya node scripts/db/oci-enqueue.mjs Muratcan --today');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
