#!/usr/bin/env node
/**
 * Google'a gidecek dönüşümlerin içeriğini şema + payload olarak tarar.
 * Muratcan (veya tüm) QUEUED/RETRY satırları için: job → ClickConversionRequest (API'ye gidecek JSON).
 *
 * Kullanım: node scripts/db/oci-google-payload-preview.mjs [Muratcan] [--include-failed]
 *           Muratcan = sadece Muratcan site. --include-failed = FAILED satırları da göster (gönderilseydi ne giderdi).
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
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

// --- Mapper mantığı (lib/providers/google_ads/mapper.ts ile uyumlu) ---
function toConversionDateTime(isoOrUnknown) {
  const d = typeof isoOrUnknown === 'string' ? new Date(isoOrUnknown) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ') + '+00:00';
  }
  return d.toISOString().slice(0, 19).replace('T', ' ') + '+00:00';
}

function normalizeClickIdForGoogle(clickId) {
  return clickId.replace(/-/g, '+').replace(/_/g, '/');
}

function minorToMajor(valueCents, currency) {
  const minorUnits = (currency === 'TRY' || currency === 'EUR' || currency === 'USD') ? 2 : 2;
  return valueCents / Math.pow(10, minorUnits);
}

function buildOrderId(clickId, conversionTime, rowId, valueCents) {
  if (!clickId) return `seal_${rowId}`.slice(0, 128);
  const input = `${clickId}|${conversionTime}|${rowId}|${valueCents}`;
  const suffix = createHash('sha256').update(input).digest('hex').slice(0, 8);
  const sanitized = conversionTime.replace(/[:.]/g, '-');
  return `${clickId}_V5_SEAL_${sanitized}_${suffix}`.slice(0, 128);
}

/** Queue row → Google ClickConversionRequest (API'ye gidecek tek satır). */
function rowToGooglePayload(row, conversionActionPlaceholder, hashedPhone) {
  const occurredAt =
    typeof row.conversion_time === 'string'
      ? row.conversion_time
      : new Date(row.conversion_time).toISOString();

  const gclid = (row.gclid ?? '').trim() || null;
  const wbraid = (row.wbraid ?? '').trim() || null;
  const gbraid = (row.gbraid ?? '').trim() || null;

  if (!gclid && !wbraid && !gbraid) {
    return { _skip: true, _reason: 'no_click_id' };
  }

  const conversionDateTime = toConversionDateTime(occurredAt);
  const valueCents = Number(row.value_cents) || 0;
  const currency = (row.currency || 'TRY').slice(0, 3);
  const orderId = buildOrderId(gclid || wbraid || gbraid, conversionDateTime, row.id, valueCents);

  const req = {
    conversion_action: conversionActionPlaceholder,
    conversion_date_time: conversionDateTime,
    conversion_value: minorToMajor(valueCents, currency),
    currency_code: currency,
    order_id: orderId,
  };

  if (gclid) req.gclid = normalizeClickIdForGoogle(gclid);
  else if (wbraid) req.wbraid = normalizeClickIdForGoogle(wbraid);
  else if (gbraid) req.gbraid = normalizeClickIdForGoogle(gbraid);

  if (hashedPhone && hashedPhone.length === 64 && /^[a-f0-9]+$/.test(hashedPhone)) {
    req.user_identifiers = [{ hashed_phone_number: hashedPhone }];
  }

  return req;
}

async function run() {
  const siteFilter = process.argv[2];
  const siteId = siteFilter && siteFilter.toLowerCase() === 'muratcan' ? MURATCAN_SITE_ID : null;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Google\'a gidecek dönüşümler — Şema ve payload önizleme');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // QUEUED + RETRY (gidecek) ve isteğe bağlı FAILED (gönderilseydi ne giderdi)
  const includeFailed = process.argv.includes('--include-failed');
  const statuses = includeFailed ? ['QUEUED', 'RETRY', 'FAILED'] : ['QUEUED', 'RETRY'];

  let query = supabase
    .from('offline_conversion_queue')
    .select('id, call_id, site_id, status, conversion_time, value_cents, currency, gclid, wbraid, gbraid, next_retry_at')
    .eq('provider_key', 'google_ads')
    .in('status', statuses);

  if (siteId) {
    query = query.eq('site_id', siteId);
    console.log('Site: Muratcan AKÜ', siteId);
  } else {
    console.log('Site: Tümü');
  }
  if (includeFailed) {
    console.log('(FAILED satırlar dahil — "gönderilseydi" payload önizlemesi)');
  }

  const { data: rows, error } = await query.order('updated_at', { ascending: false });

  if (error) {
    console.error('Kuyruk hatası:', error.message);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log('QUEUED/RETRY satır yok.\n');
    return;
  }

  const callIds = [...new Set(rows.map((r) => r.call_id).filter(Boolean))];
  let hashByCallId = new Map();
  if (callIds.length > 0) {
    const { data: calls } = await supabase
      .from('calls')
      .select('id, caller_phone_hash_sha256')
      .in('id', callIds);
    for (const c of calls ?? []) {
      const h = c.caller_phone_hash_sha256;
      if (h && String(h).trim().length === 64) {
        hashByCallId.set(c.id, String(h).trim());
      }
    }
  }

  // Şema (Google Ads API ClickConversion)
  console.log('--- ŞEMA: Google uploadClickConversions — conversions[] öğesi ---\n');
  console.log(`
  {
    conversion_action: string,     // customers/{customerId}/conversionActions/{id}
    conversion_date_time: string, // "yyyy-mm-dd hh:mm:ss+00:00" (UTC)
    conversion_value: number,      // major units (örn. 1300.00 TRY)
    currency_code: string,       // "TRY" | "USD" | ...
    order_id: string,             // deterministik, tekilleştirme
    gclid?: string,               // tam biri zorunlu (gclid | wbraid | gbraid)
    wbraid?: string,
    gbraid?: string,
    user_identifiers?: [          // Enhanced Conversions (opsiyonel)
      { hashed_phone_number?: string }
    ]
  }
`);

  console.log('--- Gidecek satır sayısı:', rows.length, '---\n');

  const conversionActionPlaceholder = 'customers/XXXXXXXX/conversionActions/YYYYYYYY';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const hashedPhone = row.call_id ? hashByCallId.get(row.call_id) : null;
    const payload = rowToGooglePayload(row, conversionActionPlaceholder, hashedPhone);

    console.log(`--- ${i + 1}. queue_id: ${row.id.slice(0, 8)}... call_id: ${(row.call_id || '').slice(0, 8)}... ---`);
    if (payload._skip) {
      console.log('  ATLANACAK:', payload._reason);
      console.log('');
      continue;
    }
    console.log('  conversion_date_time:', payload.conversion_date_time);
    console.log('  conversion_value:', payload.conversion_value, payload.currency_code);
    console.log('  order_id:', payload.order_id?.slice(0, 50) + (payload.order_id?.length > 50 ? '...' : ''));
    console.log('  click_id:', payload.gclid ? 'gclid:' + payload.gclid.slice(0, 20) + '...' : payload.wbraid ? 'wbraid:...' : 'gbraid:...');
    if (payload.user_identifiers?.length) {
      console.log('  user_identifiers: [ hashed_phone_number: ' + (payload.user_identifiers[0].hashed_phone_number?.slice(0, 16) + '...') + ' ]');
    } else {
      console.log('  user_identifiers: (yok)');
    }
    console.log('  Tam payload (API\'ye gidecek):');
    console.log(JSON.stringify(payload, null, 2));
    console.log('');
  }

  console.log('--- Özet ---');
  const withHash = rows.filter((r) => r.call_id && hashByCallId.has(r.call_id)).length;
  console.log('Toplam:', rows.length, '| Enhanced (hashed_phone ile):', withHash);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
