#!/usr/bin/env node
/**
 * Muratcan AKÜ — Derin durum analizi.
 * - GCLID kuyrukta var mı, kaybolmuş mu?
 * - Tarihsel: queue/call oluşum, son başarılı gönderim
 * - Neden "eskiden gidiyordu şimdi gitmiyor" olabilir?
 *
 * Kullanım: node scripts/db/oci-muratcan-derin-analiz.mjs
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
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Muratcan AKÜ — Derin durum analizi');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1) Son başarılı (COMPLETED) dönüşüm ne zaman?
  const { data: lastCompleted } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, uploaded_at, created_at')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads')
    .eq('status', 'COMPLETED')
    .not('uploaded_at', 'is', null)
    .order('uploaded_at', { ascending: false })
    .limit(1);

  console.log('--- 1) SON BAŞARILI GÖNDERİM (COMPLETED) ---');
  if (lastCompleted?.length) {
    const r = lastCompleted[0];
    console.log('  uploaded_at:', r.uploaded_at);
    console.log('  queue_id:', r.id);
    console.log('  → En son Google\'a giden dönüşüm bu tarihte.');
  } else {
    console.log('  Hiç COMPLETED kayıt yok (veya uploaded_at boş).');
    console.log('  → Muratcan için henüz başarılı OCI gönderimi görünmüyor veya eski kayıtlar silindi.');
  }
  console.log('');

  // 2) FAILED 7 satır: kuyrukta GCLID var mı, tarihler
  const { data: failed } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, gclid, wbraid, gbraid, created_at, updated_at, last_error, retry_count')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads')
    .eq('status', 'FAILED');

  console.log('--- 2) FAILED SATIRLAR — GCLID KUYRUKTA VAR MI? ---');
  if (!failed?.length) {
    console.log('  FAILED satır yok.');
  } else {
    let withGclid = 0;
    let withGbraidOnly = 0;
    const createdDates = failed.map((r) => r.created_at?.slice(0, 10));
    const updatedDates = failed.map((r) => r.updated_at?.slice(0, 16));
    for (const r of failed) {
      const hasG = r.gclid && String(r.gclid).trim();
      const hasW = r.wbraid && String(r.wbraid).trim();
      const hasB = r.gbraid && String(r.gbraid).trim();
      if (hasG) withGclid++;
      if (!hasG && !hasW && hasB) withGbraidOnly++;
    }
    console.log('  Toplam FAILED:', failed.length);
    console.log('  Kuyrukta GCLID dolu:', withGclid, 'satır → GCLID KAYBOLMAMIŞ, kuyrukta mevcut.');
    console.log('  Sadece gbraid (GCLID yok):', withGbraidOnly, 'satır.');
    console.log('  Oluşturulma tarihleri:', [...new Set(createdDates)].sort().join(', '));
    console.log('  Son güncelleme (FAILED işaretlendi):', [...new Set(updatedDates)].join(', '));
    console.log('  → Hepsi aynı anda FAILED olmuşsa tek worker çalışmasında toplu red alınmış demektir.');
  }
  console.log('');

  // 3) Her FAILED için session'da gclid var mı (kaynak session)
  console.log('--- 3) FAILED SATIRLAR — SESSION\'DA GCLID VAR MI? (Kaynak) ---');
  if (failed?.length) {
    for (const r of failed) {
      const { data: sess } = await supabase.rpc('get_call_session_for_oci', {
        p_call_id: r.call_id,
        p_site_id: MURATCAN_SITE_ID,
      });
      const row = Array.isArray(sess) && sess.length ? sess[0] : null;
      const sG = row?.gclid && String(row.gclid).trim();
      const sB = row?.gbraid && String(row.gbraid).trim();
      console.log(`  queue ${r.id.slice(0, 8)}... | kuyruk gclid: ${r.gclid ? 'var' : 'yok'} | session gclid: ${sG ? 'var' : 'yok'} | session gbraid: ${sB ? 'var' : 'yok'}`);
    }
  }
  console.log('');

  // 4) Özet: Sorun ne?
  console.log('--- 4) ÖZET: SORUN NE? ---');
  console.log(`
  • GCLID "kaybolmuş" DEĞİL: 6 satırda kuyrukta gclid dolu. 1 satırda sadece gbraid var.
  • Google INVALID_CLICK_ID_FORMAT veriyor: İstek gidiyor ama API kabul etmiyor.
  • Olası nedenler:
    - Aynı conversion'da hem gclid hem gbraid gönderilmesi (Google tek ID istiyor).
    - Hesap sadece gclid kabul ediyor; gbraid ile giden reddediliyor.
  • "Eskiden gidiyordu": Son COMPLETED yoksa bu 7 hiç başarıyla gitmemiş olabilir;
    veya önceden sadece gclid gönderiliyordu, sonra kuyruğa gbraid de yazılmaya başlandı ve API reddetti.
  • Yapılacak: oci-muratcan-only-gclid.mjs (sadece gclid bırak) + FAILED→QUEUED + worker.
    GCLID'siz 1 satır: backfill veya bridge ile gclid bulunmalı.
`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
