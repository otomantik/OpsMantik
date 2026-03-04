#!/usr/bin/env node
/**
 * Muratcan: Demir Mühür (V5) kuyrukta sadece 1 satış kalsın — 1500 TL + hash'li telefon.
 * Diğer kuyruk satırları COMPLETED yapılır (V5 olarak gitmez; ilk görüşme V3 sinyallerden gider).
 *
 * Kullanım: node scripts/db/oci-muratcan-demir-muhur-tek-satis.mjs
 *           node scripts/db/oci-muratcan-demir-muhur-tek-satis.mjs --dry-run
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

// 1500 TRY = 150000 cents (Muratcan'ın girdiği tek satış)
const SATIS_VALUE_CENTS = 150000;

async function run() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Muratcan — Demir Mühür: sadece 1500 TL + telefon (tek satış)');
  console.log('  Diğerleri V5 olarak gitmeyecek (ilk görüşme V3 ile gidecek)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { data: queueRows, error: qErr } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, value_cents')
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads')
    .in('status', ['QUEUED', 'RETRY', 'PROCESSING', 'UPLOADED']);

  if (qErr || !queueRows?.length) {
    console.log('Kuyrukta işlenecek satır yok.');
    process.exit(0);
  }

  const callIds = queueRows.map((r) => r.call_id).filter(Boolean);
  const { data: calls } = await supabase
    .from('calls')
    .select('id, caller_phone_e164, sale_amount')
    .eq('site_id', MURATCAN_SITE_ID)
    .in('id', callIds);

  const callMap = new Map((calls || []).map((c) => [c.id, c]));

  const with1500AndPhone = queueRows.filter((r) => {
    const v = r.value_cents != null ? Number(r.value_cents) : 0;
    const call = r.call_id ? callMap.get(r.call_id) : null;
    const hasPhone = call?.caller_phone_e164 != null && String(call.caller_phone_e164).trim().length > 0;
    return v === SATIS_VALUE_CENTS && hasPhone;
  });

  const toComplete = queueRows.filter((r) => {
    const v = r.value_cents != null ? Number(r.value_cents) : 0;
    const call = r.call_id ? callMap.get(r.call_id) : null;
    const hasPhone = call?.caller_phone_e164 != null && String(call.caller_phone_e164).trim().length > 0;
    if (v === SATIS_VALUE_CENTS && hasPhone) {
      return false;
    }
    return true;
  });

  if (with1500AndPhone.length > 1) {
    console.log('Birden fazla 1500 TL + telefon satırı var; ilki V5 kalacak, diğerleri COMPLETED.');
  }

  const keepId = with1500AndPhone.length > 0 ? with1500AndPhone[0].id : null;
  const completeIds = toComplete.map((r) => r.id);

  console.log('--- Özet ---');
  console.log('  Toplam kuyruk satırı:', queueRows.length);
  console.log('  1500 TL + telefon (V5 kalacak):', with1500AndPhone.length, keepId ? '(id: ' + keepId.slice(0, 8) + '...)' : '— YOK');
  console.log('  Diğerleri COMPLETED yapılacak (ilk görüşme V3):', completeIds.length);

  if (completeIds.length === 0) {
    const keepRow = with1500AndPhone[0];
    if (keepId && keepRow && keepRow.status !== 'QUEUED' && keepRow.status !== 'RETRY') {
      const dryRun = process.argv.includes('--dry-run');
      if (!dryRun) {
        const now = new Date().toISOString();
        const { error: requeueErr } = await supabase
          .from('offline_conversion_queue')
          .update({ status: 'QUEUED', claimed_at: null, updated_at: now })
          .eq('id', keepId)
          .eq('site_id', MURATCAN_SITE_ID);
        if (!requeueErr) {
          console.log('\n1500 TL satır QUEUED yapıldı (önceki: ' + keepRow.status + '). Script bir sonraki çalışmada 1500 TL satışı gönderecek.');
        }
      } else {
        console.log('\n[--dry-run] 1500 TL satır ' + keepRow.status + ' → QUEUED yapılacak.');
      }
    } else if (keepId && (with1500AndPhone[0]?.status === 'QUEUED' || with1500AndPhone[0]?.status === 'RETRY')) {
      console.log('\n1500 TL satır zaten QUEUED/RETRY; Script çalıştırıldığında gidecek.');
    } else {
      console.log('\nYapılacak değişiklik yok.');
    }
    process.exit(0);
  }

  if (!keepId && queueRows.length > 0) {
    console.log('\nUyarı: 1500 TL + telefonlu satır yok. Tüm satırlar COMPLETED yapılırsa hiçbiri V5 olarak gitmez.');
    console.log('  İstersen 1500 TL olan bir satırın call\'ına caller_phone_e164 girip tekrar çalıştır.');
  }

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('\n[--dry-run] UPDATE yapılmadı.');
    process.exit(0);
  }

  const now = new Date().toISOString();
  const { error: upErr } = await supabase
    .from('offline_conversion_queue')
    .update({
      status: 'COMPLETED',
      updated_at: now,
      last_error: 'SENT_AS_V3_ILK_GORUSME',
    })
    .in('id', completeIds)
    .eq('site_id', MURATCAN_SITE_ID);

  if (upErr) {
    console.error('UPDATE hatası:', upErr.message);
    process.exit(1);
  }
  console.log('\nGüncellenen:', completeIds.length, 'satır → COMPLETED (V5 olarak gönderilmeyecek, ilk görüşme V3 ile gidecek).');
  if (keepId) {
    const keepRow = with1500AndPhone[0];
    if (keepRow && keepRow.status !== 'QUEUED' && keepRow.status !== 'RETRY') {
      const { error: requeueErr } = await supabase
        .from('offline_conversion_queue')
        .update({ status: 'QUEUED', claimed_at: null, updated_at: now })
        .eq('id', keepId)
        .eq('site_id', MURATCAN_SITE_ID);
      if (!requeueErr) {
        console.log('1500 TL satır tekrar QUEUED yapıldı (bir önceki durum: ' + keepRow.status + ' → Script bir sonraki çalışmada gönderecek).');
      }
    }
    console.log('Kalan tek V5 (Demir Mühür):', keepId.slice(0, 8) + '... (1500 TL + telefon).');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
