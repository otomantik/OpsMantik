#!/usr/bin/env node
/**
 * OCI — Dün gece 22:40 (TRT) sonrası RÖNTGEN + SALDIRI AYIKLAMA.
 * Eslamed veya Muratcan (veya site adı/UUID) için:
 * - Tüm intent'leri çeker (calls: source=click, status=intent/NULL).
 * - Session ile birleştirir: süre, event sayısı, proxy, fingerprint, IP.
 * - Saldırı kriterleri (runbook ile uyumlu): ≤3sn kalış, tek etkileşim, proxy, aynı FP >3, aynı IP >5.
 * - Temiz kuyruk (Google'a gönderilecek) ve saldırı listesi üretir.
 *
 * Kullanım:
 *   node scripts/db/oci-2240-rontgen-saldiri-ayikla.mjs Eslamed
 *   node scripts/db/oci-2240-rontgen-saldiri-ayikla.mjs Muratcan
 *   node scripts/db/oci-2240-rontgen-saldiri-ayikla.mjs Muratcan --full
 *   node scripts/db/oci-2240-rontgen-saldiri-ayikla.mjs Muratcan --no-write
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const siteArg = argv[0] || 'Eslamed';
const fullOutput = process.argv.includes('--full');
const noWrite = process.argv.includes('--no-write');

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

function ts(s) {
  return s ? new Date(s).toISOString().slice(0, 19).replace('T', ' ') : '-';
}

async function resolveSite(q) {
  if (!q) return null;
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
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .or(`name.ilike.%${q}%,domain.ilike.%${q}%`)
    .limit(1);
  return data?.[0] || null;
}

/** Dosya adı için güvenli site slug (Eslamed -> eslamed, Muratcan -> muratcan) */
function siteSlug(name) {
  return (name || 'site').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'site';
}

async function main() {
  const sinceIso = getSince2240TRT();
  const site = await resolveSite(siteArg);
  if (!site) {
    console.error('Site bulunamadı:', siteArg);
    console.error('Örnek: node scripts/db/oci-2240-rontgen-saldiri-ayikla.mjs Eslamed');
    console.error('       node scripts/db/oci-2240-rontgen-saldiri-ayikla.mjs Muratcan');
    process.exit(1);
  }
  const siteId = site.id;
  const siteName = site.name || siteArg;

  console.log('\n══════════════════════════════════════════════════════════════════════════════');
  console.log('  ' + siteName.toUpperCase() + ' — DÜN GECE 22:40 (TRT) SONRASI RÖNTGEN + SALDIRI AYIKLAMA');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  Site:', siteName, '| UUID:', siteId);
  console.log('  Başlangıç (TRT 22:40 dün):', sinceIso);
  console.log('  Şimdi (UTC):              ', new Date().toISOString());
  console.log('');

  // ─── 1) 22:40 sonrası tüm intent'ler (click; status = intent veya NULL — kuyrukta görünenler)
  const { data: callsIntent, error: errIntent } = await supabase
    .from('calls')
    .select('id, created_at, intent_action, matched_session_id, status')
    .eq('site_id', siteId)
    .eq('source', 'click')
    .or('status.eq.intent,status.is.null')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });

  if (errIntent) {
    console.error('Calls (intent) çekilemedi:', errIntent);
    process.exit(1);
  }

  const intentCalls = callsIntent || [];

  // Aynı pencerede mühürlenen (bilgi için)
  const { data: sealedCalls } = await supabase
    .from('calls')
    .select('id')
    .eq('site_id', siteId)
    .in('status', ['confirmed', 'qualified', 'real'])
    .gte('created_at', sinceIso);
  const sealedInWindow = sealedCalls || [];

  if (intentCalls.length === 0) {
    console.log('  22:40 sonrası intent (status=intent/NULL) bulunamadı.');
    console.log('  Mühürlenen (confirmed/qualified/real) bu pencerede:', sealedInWindow.length);
    console.log('');
    return;
  }

  const sessionIds = [...new Set(intentCalls.map((c) => c.matched_session_id).filter(Boolean))];
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, fingerprint, ip_address, total_duration_sec, event_count, is_proxy_detected')
    .eq('site_id', siteId)
    .in('id', sessionIds);

  const sessionById = new Map((sessions || []).map((s) => [s.id, s]));

  // FP ve IP sayıları (bu penceredeki intent'lere göre)
  const fpCount = new Map();
  const ipCount = new Map();
  for (const c of intentCalls) {
    const s = sessionById.get(c.matched_session_id);
    const fp = s?.fingerprint ?? null;
    const ip = s?.ip_address != null ? String(s.ip_address) : null;
    if (fp) fpCount.set(fp, (fpCount.get(fp) || 0) + 1);
    if (ip) ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  }

  const rows = [];
  for (const c of intentCalls) {
    const s = sessionById.get(c.matched_session_id);
    const duration = s?.total_duration_sec ?? null;
    const events = s?.event_count ?? null;
    const proxy = s?.is_proxy_detected === true;
    const fp = s?.fingerprint ?? null;
    const ip = s?.ip_address != null ? String(s.ip_address) : null;
    const nFp = fp ? fpCount.get(fp) || 0 : 0;
    const nIp = ip ? ipCount.get(ip) || 0 : 0;

    const flag_3sn = duration != null && duration <= 3;
    const flag_tek = events != null && events <= 1;
    const flag_proxy = proxy;
    const flag_fp = nFp > 3;
    const flag_ip = nIp > 5;
    const suspekt = flag_3sn || flag_tek || flag_proxy || flag_fp || flag_ip;

    rows.push({
      call_id: c.id,
      created_at: c.created_at,
      intent_action: c.intent_action,
      status: c.status,
      total_duration_sec: duration,
      event_count: events,
      is_proxy_detected: proxy,
      ayni_fp_intent: nFp,
      ayni_ip_intent: nIp,
      flag_3sn_alti_kalis: flag_3sn,
      flag_tek_etkilesim: flag_tek,
      flag_proxy: flag_proxy,
      flag_ayni_fp_cok: flag_fp,
      flag_ayni_ip_cok: flag_ip,
      suspekt,
    });
  }

  const saldiri = rows.filter((r) => r.suspekt);
  const temiz = rows.filter((r) => !r.suspekt);

  // ─── ÖZET
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  ÖZET (22:40 TRT sonrası intent\'ler)');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  Toplam intent (bu pencere):', intentCalls.length);
  console.log('  Saldırı (şüpheli):         ', saldiri.length);
  console.log('  Temiz (Google\'a gönderilecek):', temiz.length);
  console.log('  Bu pencerede mühürlenen:   ', sealedInWindow.length);
  console.log('');

  // ─── Kritere göre dağılım
  const kriterCount = {
    '≤3sn kalış': rows.filter((r) => r.flag_3sn_alti_kalis).length,
    'Tek etkileşim': rows.filter((r) => r.flag_tek_etkilesim).length,
    'Proxy/VPN': rows.filter((r) => r.flag_proxy).length,
    'Aynı FP >3 intent': rows.filter((r) => r.flag_ayni_fp_cok).length,
    'Aynı IP >5 intent': rows.filter((r) => r.flag_ayni_ip_cok).length,
  };
  console.log('  Kriterlere göre (en az birini karşılayan intent sayısı):');
  Object.entries(kriterCount).forEach(([k, v]) => console.log('    ', k + ':', v));
  console.log('');

  // ─── Röntgen tablosu (tümü veya ilk N)
  const showRows = fullOutput ? rows : rows.slice(0, 60);
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  RÖNTGEN (her intent satırı)' + (fullOutput ? '' : ' — ilk 60, tam liste için --full'));
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  created_at          | suspekt | 3sn | tek | proxy | fp>3 | ip>5 | call_id (8)');
  console.log('  ' + '-'.repeat(85));
  for (const r of showRows) {
    const idShort = (r.call_id || '').toString().slice(0, 8);
    console.log(
      '  ' +
        [
          ts(r.created_at),
          r.suspekt ? 'SALDIRI' : 'temiz ',
          r.flag_3sn_alti_kalis ? '1' : '-',
          r.flag_tek_etkilesim ? '1' : '-',
          r.flag_proxy ? '1' : '-',
          r.flag_ayni_fp_cok ? '1' : '-',
          r.flag_ayni_ip_cok ? '1' : '-',
          idShort + '...',
        ].join(' | ')
    );
  }
  if (!fullOutput && rows.length > 60) console.log('  ... ve', rows.length - 60, 'satır daha (--full ile hepsi).');
  console.log('');

  // ─── Temiz kuyruk (Google'a gönderilecek)
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  TEMİZ KUYRUK (Google\'a gönderilecek — ' + temiz.length + ' intent)');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  if (temiz.length > 0) {
    temiz.forEach((r, i) => {
      console.log('  ' + String(i + 1).padStart(3) + ' | ' + r.call_id + ' | ' + ts(r.created_at));
    });
  } else {
    console.log('  (Temiz intent yok.)');
  }
  console.log('');

  // ─── Saldırı call_id listesi (junk için)
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  SALDIRI (şüpheli — junk yapılacak call_id\'ler)');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  if (saldiri.length > 0) {
    saldiri.forEach((r, i) => {
      console.log('  ' + String(i + 1).padStart(3) + ' | ' + r.call_id + ' | ' + ts(r.created_at));
    });
  } else {
    console.log('  (Şüpheli intent yok.)');
  }
  console.log('');

  // ─── Dosyaya yaz (tmp/)
  if (!noWrite && (temiz.length > 0 || saldiri.length > 0)) {
    const tmpDir = join(__dirname, '..', '..', 'tmp');
    try {
      mkdirSync(tmpDir, { recursive: true });
    } catch (_) {}
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = siteSlug(siteName);
    const prefix = 'oci-' + slug + '-2240-' + stamp;

    if (temiz.length > 0) {
      const temizPath = join(tmpDir, prefix + '-temiz-kuyruk.json');
      writeFileSync(
        temizPath,
        JSON.stringify(
          temiz.map((r) => ({
            call_id: r.call_id,
            created_at: r.created_at,
            intent_action: r.intent_action,
          })),
          null,
          2
        ),
        'utf8'
      );
      console.log('  Temiz kuyruk yazıldı:', temizPath);
    }
    if (saldiri.length > 0) {
      const saldiriPath = join(tmpDir, prefix + '-saldiri-call-ids.json');
      writeFileSync(
        saldiriPath,
        JSON.stringify(
          saldiri.map((r) => ({
            call_id: r.call_id,
            created_at: r.created_at,
            flags: {
              flag_3sn_alti_kalis: r.flag_3sn_alti_kalis,
              flag_tek_etkilesim: r.flag_tek_etkilesim,
              flag_proxy: r.flag_proxy,
              flag_ayni_fp_cok: r.flag_ayni_fp_cok,
              flag_ayni_ip_cok: r.flag_ayni_ip_cok,
            },
          })),
          null,
          2
        ),
        'utf8'
      );
      console.log('  Saldırı listesi yazıldı:', saldiriPath);
    }
    const rontgenPath = join(tmpDir, prefix + '-rontgen-full.json');
    writeFileSync(rontgenPath, JSON.stringify(rows, null, 2), 'utf8');
    console.log('  Tam röntgen (tüm satırlar):', rontgenPath);
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  SONRAKI ADIMLAR');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  1) Saldırı call\'larını junk\'lamak: Dashboard\'dan tek tek veya tmp/*-saldiri-call-ids.json ile toplu.');
  console.log('  2) Temiz intent\'ler: V2 nabız + export ile Google\'a gider; saldırı junk\'landıktan sonra kuyruk sadece temizi gösterir.');
  console.log('  3) Mühür (V5) kuyruğa almak: node scripts/db/oci-enqueue.mjs ' + siteName + ' --today');
  console.log('══════════════════════════════════════════════════════════════════════════════\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
