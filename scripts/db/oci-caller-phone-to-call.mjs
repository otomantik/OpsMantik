#!/usr/bin/env node
/**
 * Verilen telefonu E.164'e çevirip hash hesaplar; isteğe bağlı olarak belirtilen call'a yazar.
 * Enhanced Conversions için caller_phone_e164 + caller_phone_hash_sha256 doldurulur.
 *
 * Kullanım:
 *   node scripts/db/oci-caller-phone-to-call.mjs 05306315608
 *   node scripts/db/oci-caller-phone-to-call.mjs 05306315608 --call-id=30280292-341c-48ee-8fc5-9b7445774c1f
 *
 * Telefon argüman olarak verilir (repoda saklanmaz).
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
const salt = process.env.OCI_PHONE_HASH_SALT ?? '';

function normalizeToE164(raw, countryIso = 'TR') {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits.length) return null;
  const codes = { TR: '90', US: '1', GB: '44' };
  const cc = codes[countryIso] || '90';
  if (digits.startsWith(cc) && digits.length >= 10) return digits;
  if (digits.startsWith('0') && digits.length >= 10) return cc + digits.slice(1);
  if (digits.length >= 10) return cc + digits;
  return null;
}

function hashPhoneForEC(e164Digits, saltStr) {
  const encoded = Buffer.from(saltStr + e164Digits, 'utf8');
  return createHash('sha256').update(encoded).digest('hex').toLowerCase();
}

async function main() {
  const raw = process.argv[2];
  const callIdArg = process.argv.find((a) => a.startsWith('--call-id='));
  const callId = callIdArg ? callIdArg.slice('--call-id='.length).trim() : null;

  if (!raw || !raw.trim()) {
    console.error('Kullanım: node scripts/db/oci-caller-phone-to-call.mjs <telefon> [--call-id=uuid]');
    process.exit(1);
  }

  const e164 = normalizeToE164(raw.trim(), 'TR');
  if (!e164) {
    console.error('Geçersiz telefon; E.164\'e çevrilemedi.');
    process.exit(1);
  }

  const hash = hashPhoneForEC(e164, salt);
  console.log('E.164:', e164);
  console.log('Hash (SHA256 hex):', hash);

  if (callId && url && key) {
    const supabase = createClient(url, key);
    const { data: call, error: fetchErr } = await supabase
      .from('calls')
      .select('id, version, status, sale_amount, currency, lead_score, confirmed_at')
      .eq('id', callId)
      .maybeSingle();

    if (fetchErr || !call) {
      console.error('Call bulunamadı veya hata:', fetchErr?.message || 'not found');
      process.exit(1);
    }

    // Seal RPC tüm alanları günceller; mevcut değerleri koruyup sadece telefon ekliyoruz
    const payload = {
      caller_phone_raw: raw.trim().slice(0, 64),
      caller_phone_e164: e164,
      caller_phone_hash_sha256: hash,
      sale_amount: call.sale_amount ?? null,
      currency: (call.currency || 'TRY').trim(),
      lead_score: call.lead_score ?? null,
    };

    const { error: rpcErr } = await supabase.rpc('apply_call_action_v1', {
      p_call_id: callId,
      p_action_type: 'seal',
      p_payload: payload,
      p_actor_type: 'system',
      p_actor_id: null,
      p_metadata: { source: 'oci-caller-phone-to-call.mjs' },
      p_version: call.version ?? 0,
    });

    if (rpcErr) {
      console.error('Call güncellenemedi:', rpcErr.message);
      process.exit(1);
    }
    console.log('Call güncellendi (caller_phone + hash).');
  } else if (callId) {
    console.error('Supabase env yok; call güncellenemedi. Sadece E.164 ve hash yazdırıldı.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
