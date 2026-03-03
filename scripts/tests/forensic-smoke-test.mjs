/**
 * Attribution Forensic Validator — tek call için DIC + Forensic RPC ve hash kontrolü.
 * HASH_MISMATCH: caller_phone_e164 + caller_phone_hash_sha256 varsa Node tarafında hash yeniden hesaplanır ve karşılaştırılır.
 * Kullanım: CALL_ID=uuid SITE_ID=uuid node scripts/tests/forensic-smoke-test.mjs
 * .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OCI_PHONE_HASH_SALT (optional)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (.env.local)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

/** Minimal E.164: digits only; prepend country if leading 0. Not full lib/dic. */
function simpleE164(rawPhone, countryCode) {
  const digits = (rawPhone || '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (digits.startsWith('0')) {
    const local = digits.replace(/^0+/, '');
    return local.startsWith(countryCode) ? local : countryCode + local;
  }
  return digits.startsWith(countryCode) ? digits : countryCode + digits;
}

/** UTF-8 SHA256 hex (salt + value). */
function sha256Hex(salt, value) {
  const buf = Buffer.from(salt + value, 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
}

async function runForensicTest(callId, siteId) {
  console.log(`\n--- Forensic Audit for Call: ${callId} (site: ${siteId}) ---\n`);

  const pCallId = callId;
  const pSiteId = siteId;

  // 1. DIC Export
  const { data: dicRows, error: dicErr } = await supabase.rpc('get_dic_export_for_call', {
    p_call_id: pCallId,
    p_site_id: pSiteId,
  });
  if (dicErr) {
    console.error('❌ DIC Export failed:', dicErr.message);
    return;
  }
  const dic = Array.isArray(dicRows) ? dicRows[0] : dicRows;
  if (!dic) {
    console.log('⚠️ No DIC row (call not found or no data)');
  } else {
    console.log('[DIC] raw_phone_string:', dic.raw_phone_string ?? '(null)');
    console.log('[DIC] phone_source_type:', dic.phone_source_type ?? '(null)');
    console.log('[DIC] detected_country_iso:', dic.detected_country_iso ?? '(null)');
    console.log('[DIC] event_timestamp_utc_ms:', dic.event_timestamp_utc_ms ?? '(null)');
    console.log('[DIC] first_fingerprint_touch_utc_ms:', dic.first_fingerprint_touch_utc_ms ?? '(null)');
    console.log('[DIC] historical_gclid_presence:', dic.historical_gclid_presence ?? '(null)');

    const countryCode = (dic.detected_country_iso === 'TR' && '90') || (dic.detected_country_iso === 'US' && '1') || null;
    const e164 = countryCode && dic.raw_phone_string ? simpleE164(dic.raw_phone_string, countryCode) : null;
    const hash = e164 ? sha256Hex('', e164) : null;
    console.log(hash ? '✅ Hash can be generated (E.164 → SHA256 hex)' : '⚠️ Hash not computed (missing phone or country)');
    if (hash) console.log('[DIC] sha256_phone_hex (sample):', hash.slice(0, 16) + '...');
  }

  // 2. Forensic Layer
  const { data: forensicRows, error: foreErr } = await supabase.rpc('get_attribution_forensic_export_for_call', {
    p_call_id: pCallId,
    p_site_id: pSiteId,
  });
  if (foreErr) {
    console.error('❌ Forensic Export failed:', foreErr.message);
    return;
  }
  const forensic = Array.isArray(forensicRows) ? forensicRows[0] : forensicRows;
  if (!forensic) {
    console.log('\n⚠️ No Forensic row');
    return;
  }

  console.log('\n[Diagnostic] failure_mode:', forensic.failure_mode ?? '(none)');
  console.log('[Diagnostic] identity_resolution_score:', forensic.identity_resolution_score ?? '(null)');
  console.log('[Diagnostic] cross_device_fingerprint_link:', forensic.cross_device_fingerprint_link ?? '(null)');
  console.log('[Diagnostic] clids_discarded_count:', forensic.clids_discarded_count ?? 0);

  // HASH_MISMATCH: Node-only check when caller_phone_e164 and caller_phone_hash_sha256 present
  const { data: callRow } = await supabase
    .from('calls')
    .select('caller_phone_e164, caller_phone_hash_sha256')
    .eq('id', pCallId)
    .eq('site_id', pSiteId)
    .maybeSingle();
  if (callRow?.caller_phone_e164 && callRow?.caller_phone_hash_sha256) {
    const salt = process.env.OCI_PHONE_HASH_SALT ?? '';
    const digits = (callRow.caller_phone_e164 || '').replace(/\D/g, '');
    const computed = digits ? sha256Hex(salt, digits) : null;
    if (computed && computed !== callRow.caller_phone_hash_sha256) {
      console.error('\n🚨 HASH_MISMATCH: Stored hash differs from recomputed (salt/env mismatch or corruption).');
    } else if (computed) {
      console.log('✅ Hash verified (caller_phone_e164 → stored hash matches recompute)');
    }
  }

  if (forensic.failure_mode === 'ORPHANED_CONVERSION') {
    console.warn('\n⚠️ Signal Warning: No fingerprint history found. This might be a pure offline lead.');
  }
  if (forensic.failure_mode === 'SIGNAL_STALE') {
    console.warn('\n⚠️ Signal Stale: First touch exceeds 30-day Google attribution window.');
  }
  if (Number(forensic.clids_discarded_count) > 0) {
    console.error(`\n🚨 System Alert: ${forensic.clids_discarded_count} malformed GCLIDs were discarded for this conversion before.`);
  }

  let tp = forensic.touchpoint_entropy;
  if (typeof tp === 'string') try { tp = JSON.parse(tp); } catch { tp = null; }
  if (tp && Array.isArray(tp) && tp.length > 0) {
    console.log('\n[Touchpoint Entropy] count:', tp.length);
    const ips = [...new Set(tp.map((x) => x?.ip_address).filter(Boolean))];
    const uas = [...new Set(tp.map((x) => x?.user_agent).filter(Boolean))];
    if (ips.length > 1) console.log('  → Multiple IPs in 14d (VPN/Relay possible)');
    if (uas.length > 1) console.log('  → Multiple UAs in 14d (browser/device change)');
  }

  console.log('\n--- End Forensic Audit ---\n');
}

const callId = process.env.CALL_ID;
const siteId = process.env.SITE_ID;

if (!callId || !siteId) {
  console.log('Usage: CALL_ID=<uuid> SITE_ID=<uuid> node scripts/tests/forensic-smoke-test.mjs');
  console.log('Example: CALL_ID=12d75067-08f7-412b-9586-68e6bc25d345 SITE_ID=c644fff7-9d7a-440d-b9bf-99f3a0f86073 node scripts/tests/forensic-smoke-test.mjs');
  process.exit(1);
}

runForensicTest(callId, siteId).catch((err) => {
  console.error(err);
  process.exit(1);
});
