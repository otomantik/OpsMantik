#!/usr/bin/env node
/**
 * Muratcan AKÜ — GCLID yakalama teşhisi.
 * Son 7 gün: session'larda gclid oranı, attribution dağılımı.
 * FAILED kuyruk satırlarının session'ında gclid var mı (yakalıyoruz ama Google reddediyor mu)?
 *
 * Kullanım: node scripts/db/oci-muratcan-gclid-yakalama-teşhis.mjs
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
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  console.log('Muratcan AKÜ — GCLID yakalama teşhisi (son 7 gün)');
  console.log('');

  // 1) Session sayıları: toplam, gclid dolu, wbraid/gbraid dolu, attribution_source dağılımı
  const { data: sessions, error: sessErr } = await supabase
    .from('sessions')
    .select('id, gclid, wbraid, gbraid, attribution_source, created_at')
    .eq('site_id', MURATCAN_SITE_ID)
    .gte('created_at', sevenDaysAgo);

  if (sessErr) {
    console.error('Session hatası:', sessErr.message);
    process.exit(1);
  }

  const list = sessions || [];
  const withGclid = list.filter((s) => s.gclid != null && String(s.gclid).trim() !== '').length;
  const withWbraid = list.filter((s) => s.wbraid != null && String(s.wbraid).trim() !== '').length;
  const withGbraid = list.filter((s) => s.gbraid != null && String(s.gbraid).trim() !== '').length;
  const withAnyClickId = list.filter(
    (s) =>
      (s.gclid != null && String(s.gclid).trim() !== '') ||
      (s.wbraid != null && String(s.wbraid).trim() !== '') ||
      (s.gbraid != null && String(s.gbraid).trim() !== '')
  ).length;
  const organic = list.filter((s) => (s.attribution_source || '').toLowerCase().includes('organic')).length;
  const paid = list.filter(
    (s) =>
      (s.attribution_source || '').toLowerCase().includes('paid') ||
      (s.attribution_source || '').toLowerCase().includes('first click')
  ).length;

  const attrCounts = {};
  for (const s of list) {
    const a = s.attribution_source || 'null';
    attrCounts[a] = (attrCounts[a] || 0) + 1;
  }

  console.log('--- SESSION (son 7 gün) ---');
  console.log('Toplam session:', list.length);
  console.log('GCLID dolu:', withGclid);
  console.log('wbraid dolu:', withWbraid);
  console.log('gbraid dolu:', withGbraid);
  console.log('En az bir click ID (gclid/wbraid/gbraid):', withAnyClickId);
  console.log('Attribution Organic (yaklaşık):', organic);
  console.log('Attribution Paid/First Click (yaklaşık):', paid);
  console.log('attribution_source dağılımı:', attrCounts);
  if (list.length > 0) {
    const pct = Math.round((withAnyClickId / list.length) * 100);
    console.log('Click ID yakalama oranı (session bazlı):', pct + '%');
  }
  console.log('');

  // 2) FAILED kuyruk satırları — bu call'ların session'ında gclid var mı?
  const { data: failedRows } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, gclid, wbraid, gbraid, last_error')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads')
    .eq('status', 'FAILED');

  if (failedRows?.length > 0) {
    console.log('--- FAILED KUYRUK SATIRLARI — Session\'da GCLID var mı? ---');
    console.log('(Kuyrukta GCLID var ama Google INVALID_CLICK_ID_FORMAT veriyorsa = yakalıyoruz, Google reddediyor)');
    let sessionHasGclid = 0;
    let queueHasGclid = 0;
    for (const row of failedRows) {
      const { data: rpcRows } = await supabase.rpc('get_call_session_for_oci', {
        p_call_id: row.call_id,
        p_site_id: MURATCAN_SITE_ID,
      });
      const session = Array.isArray(rpcRows) && rpcRows.length > 0 ? rpcRows[0] : null;
      const sessGclid = session?.gclid != null && String(session.gclid).trim() !== '';
      const queueGclid = row.gclid != null && String(row.gclid).trim() !== '';
      if (sessGclid) sessionHasGclid++;
      if (queueGclid) queueHasGclid++;
    }
    console.log('FAILED satır sayısı:', failedRows.length);
    console.log('Kuyrukta gclid dolu:', queueHasGclid);
    console.log('Session\'da gclid dolu (get_call_session_for_oci):', sessionHasGclid);
    if (queueHasGclid === failedRows.length - 1 && failedRows.length >= 1) {
      console.log('→ Sonuç: Kuyrukta GCLID yakalanmış; sorun büyük ihtimalle Google tarafında (format/hesap). Sadece gclid bırak + QUEUED yap.');
    } else if (sessionHasGclid < failedRows.length) {
      console.log('→ Bazı call\'ların session\'ında GCLID yok; o call\'lar için yakalama/Organic kontrol edilmeli.');
    }
    console.log('');
  }

  console.log('--- ÖZET ---');
  if (withAnyClickId === 0 && list.length > 0) {
    console.log('UYARI: Son 7 günde hiç session\'da click ID yok. GCLID muhtemelen yakalanmıyor (client göndermiyor veya hep Organic).');
  } else if (withAnyClickId > 0) {
    console.log('Session\'larda click ID var; yakalama çalışıyor. FAILED ise INVALID_CLICK_ID_FORMAT → runbook: sadece gclid, QUEUED, backfill.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
