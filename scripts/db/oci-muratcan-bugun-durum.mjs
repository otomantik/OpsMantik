#!/usr/bin/env node
/**
 * Muratcan bugünkü durum: mühür / won / mühür-legacy, GCLID, kuyruk.
 * Şema uyumlu: `calls` seçiminde * (sale_amount / oci_status opsiyonel).
 *
 * Kullanım: node scripts/db/oci-muratcan-bugun-durum.mjs
 *           node scripts/db/oci-muratcan-bugun-durum.mjs muratcanaku.com
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

function sealedLike(call) {
  const st = (call.status ?? '').trim().toLowerCase();
  if (st === 'won') return true;
  if (!['confirmed', 'qualified', 'real'].includes(st)) return false;
  if (Object.prototype.hasOwnProperty.call(call, 'oci_status')) {
    return (call.oci_status ?? '').trim().toLowerCase() === 'sealed';
  }
  return true;
}

async function run() {
  const siteArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const siteId = await resolveSiteId(supabase, siteArg || 'muratcanaku');
  if (!siteId) {
    console.error('Site bulunamadı.');
    process.exit(1);
  }

  const { data: label } = await supabase.from('sites').select('name,domain').eq('id', siteId).maybeSingle();
  const today = new Date().toISOString().slice(0, 10);

  console.log(`${label?.name ?? 'Site'} (${label?.domain ?? '—'}) — Bugünkü durum`);
  console.log('site_id:', siteId);
  console.log('Tarih:', today);
  console.log('');

  const { data: rawCalls, error: callsErr } = await supabase
    .from('calls')
    .select('*')
    .eq('site_id', siteId)
    .in('status', ['won', 'confirmed', 'qualified', 'real']);

  if (callsErr) {
    console.error('Calls hatası:', callsErr.message);
    process.exit(1);
  }

  const mühürAdayları = (rawCalls || []).filter(sealedLike);
  const bugunCalls = mühürAdayları.filter((c) => {
    const ca = (c.confirmed_at && String(c.confirmed_at).startsWith(today)) || false;
    const ma = (c.matched_at && String(c.matched_at).startsWith(today)) || false;
    const cre = c.created_at && String(c.created_at).startsWith(today);
    return ca || ma || cre;
  });

  console.log("--- BUGÜN 'MÜHÜR / WON / SEAL-LIKE' CALL'LAR ---");
  console.log('Toplam:', bugunCalls.length);
  if (bugunCalls.length === 0) {
    console.log('Bugün kayıt yok.');
    process.exit(0);
  }

  const callIds = bugunCalls.map((c) => c.id);
  const { data: queueRows } = await supabase
    .from('offline_conversion_queue')
    .select('call_id, status, gclid, wbraid, gbraid, value_cents, last_error')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .in('call_id', callIds);

  const queueByCall = new Map((queueRows || []).map((q) => [q.call_id, q]));

  let withClickId = 0;
  let inQueue = 0;
  let queueCompleted = 0;
  let queueFailed = 0;
  let queueQueued = 0;
  const detay = [];

  for (const c of bugunCalls) {
    const q = queueByCall.get(c.id);
    const { data: rpcRows } = await supabase.rpc('get_call_session_for_oci', {
      p_call_id: c.id,
      p_site_id: siteId,
    });
    const session = Array.isArray(rpcRows) && rpcRows.length > 0 ? rpcRows[0] : null;
    const hasGclid = session?.gclid != null && String(session.gclid).trim() !== '';
    const hasWbraid = session?.wbraid != null && String(session.wbraid).trim() !== '';
    const hasGbraid = session?.gbraid != null && String(session.gbraid).trim() !== '';
    const hasClickId = hasGclid || hasWbraid || hasGbraid;

    if (hasClickId) withClickId++;

    let qStatus = '-';
    if (q) {
      inQueue++;
      qStatus = q.status;
      if (q.status === 'COMPLETED') queueCompleted++;
      else if (q.status === 'FAILED' || q.status === 'RETRY') queueFailed++;
      else if (q.status === 'QUEUED' || q.status === 'PROCESSING') queueQueued++;
    }

    const saleAmt = typeof c.sale_amount === 'number' ? c.sale_amount : c.sale_amount != null ? Number(c.sale_amount) : null;
    const value =
      saleAmt != null && Number.isFinite(saleAmt) ? `${saleAmt} TL` : c.lead_score != null ? `score ${c.lead_score}` : '-';

    detay.push({
      call_id: c.id.slice(0, 8) + '...',
      stat: (c.status ?? '').slice(0, 4),
      value,
      gclid: hasGclid ? 'var' : '-',
      wbraid: hasWbraid ? 'var' : '-',
      gbraid: hasGbraid ? 'var' : '-',
      kuyruk: qStatus,
      gidebilir: hasClickId ? (q?.status === 'COMPLETED' ? 'gitti' : 'kuyruğa alınsa gider') : 'GCLID yok, gitmez',
    });
  }

  console.table(detay);
  console.log('');
  console.log('--- ÖZET ---');
  console.log('Bugün (seal-like):', bugunCalls.length);
  console.log('Click id olan:', withClickId);
  console.log('Kuyrukta:', inQueue, ' → COMPLETED:', queueCompleted, '| QUEUED/PROCESSING:', queueQueued, '| FAILED/RETRY:', queueFailed);
  console.log('Click id eksik:', bugunCalls.length - withClickId);
  console.log('');
  if (queueFailed > 0 && withClickId > 0) {
    console.log('→ FAILED/RETRY: oci-muratcan-only-gclid / backfill + worker.');
  }
  if (withClickId > inQueue) {
    console.log('→ Click id var, kuyrukta yok: outbox + enqueue kontrol.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
