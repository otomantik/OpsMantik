#!/usr/bin/env node
/**
 * Muratcan bugünkü durum: Mühür sayısı, GCLID var mı, kuyrukta mı, gidebilir mi?
 * Kullanım: node scripts/db/oci-muratcan-bugun-durum.mjs
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

async function run() {
  const today = new Date().toISOString().slice(0, 10);

  console.log('Muratcan AKÜ — Bugünkü durum');
  console.log('Tarih:', today);
  console.log('');

  // Bugünkü mühür (sealed) call'lar
  const { data: calls, error: callsErr } = await supabase
    .from('calls')
    .select('id, confirmed_at, matched_at, lead_score, sale_amount, status, oci_status')
    .eq('site_id', MURATCAN_SITE_ID)
    .in('status', ['confirmed', 'qualified', 'real'])
    .eq('oci_status', 'sealed');

  if (callsErr) {
    console.error('Calls hatası:', callsErr.message);
    process.exit(1);
  }

  const bugunCalls = (calls || []).filter(
    (c) =>
      (c.confirmed_at && c.confirmed_at.startsWith(today)) ||
      (c.matched_at && c.matched_at.startsWith(today))
  );

  console.log('--- BUGÜN MÜHÜR OLAN CALL\'LAR ---');
  console.log('Toplam:', bugunCalls.length);
  if (bugunCalls.length === 0) {
    console.log('Bugün mühür yok.');
    process.exit(0);
  }

  // Kuyruk satırları (bu call'lar için)
  const callIds = bugunCalls.map((c) => c.id);
  const { data: queueRows } = await supabase
    .from('offline_conversion_queue')
    .select('call_id, status, gclid, wbraid, gbraid, value_cents, last_error')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads')
    .in('call_id', callIds);

  const queueByCall = new Map((queueRows || []).map((q) => [q.call_id, q]));

  // Her call için session'dan gclid/wbraid/gbraid al (get_call_session_for_oci)
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
      p_site_id: MURATCAN_SITE_ID,
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

    const value = c.sale_amount != null ? `${c.sale_amount} TL` : (c.lead_score != null ? `score ${c.lead_score}` : '-');
    detay.push({
      call_id: c.id.slice(0, 8) + '...',
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
  console.log('Bugün mühür:', bugunCalls.length);
  console.log('GCLID/wbraid/gbraid olan (kuyruğa alınsa gidebilecek):', withClickId);
  console.log('Kuyrukta kayıt var:', inQueue, '  → COMPLETED:', queueCompleted, '| QUEUED/PROCESSING:', queueQueued, '| FAILED/RETRY:', queueFailed);
  console.log('GCLID olmayan (kuyruğa alsak da Google kabul etmez):', bugunCalls.length - withClickId);
  console.log('');
  if (queueFailed > 0 && withClickId > 0) {
    console.log('→ FAILED/RETRY olanlar için: node scripts/db/oci-muratcan-only-gclid.mjs ve/veya oci-muratcan-backfill-gclid-from-session.mjs sonra worker çalıştır.');
  }
  if (withClickId > inQueue) {
    console.log('→ GCLID var ama kuyrukta olmayan mühür var; enqueue (seal sırasında veya manuel) gerekir.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
