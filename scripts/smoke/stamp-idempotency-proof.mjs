#!/usr/bin/env node
/**
 * Phase 1 — stamp idempotency proof
 *
 * Tests:
 * 1) Post whatsapp click WITHOUT intent_stamp => expect:
 *    - server generated intent_stamp
 *    - intent_action='whatsapp'
 *    - intent_target starts with 'wa:' (prefer wa:+...)
 * 2) Post two identical whatsapp clicks (same stamp, messy URL) => expect 1 calls row
 * 3) Post tel then whatsapp within 5s => expect 2 calls rows (different intent_action + target prefixes)
 * 4) Invariants: intent_action only 'phone'|'whatsapp' and targets start with 'tel:'|'wa:'
 *
 * Env:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SYNC_API_URL (default http://localhost:3100/api/sync)
 * - ORIGIN (default https://www.poyrazantika.com)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);

const SYNC_API_URL = process.env.SYNC_API_URL || 'http://localhost:3100/api/sync';
const ORIGIN = process.env.ORIGIN || 'https://www.poyrazantika.com';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function monthKeyUTC() {
  return new Date().toISOString().slice(0, 7) + '-01';
}

async function pickSitePublicId() {
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const uuid32Hex = /^[0-9a-f]{32}$/i; // accepted by /api/sync normalization
  const { data, error } = await supabase.from('sites').select('id, public_id').not('public_id', 'is', null).limit(100);
  if (error) throw error;
  const row = (data || []).find((r) => {
    if (typeof r?.public_id !== 'string') return false;
    const v = r.public_id.trim();
    return uuidV4Regex.test(v) || uuid32Hex.test(v);
  });
  if (!row?.public_id) throw new Error('No sites.public_id found');
  return { site_id: row.id, site_public_id: row.public_id.trim() };
}

async function postSync(payload) {
  const r = await fetch(SYNC_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN },
    body: JSON.stringify(payload),
  });
  const text = await r.text().catch(() => '');
  if (!r.ok) throw new Error(`sync_http_${r.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text || '{}');
  if (!body?.ok) throw new Error(`sync_not_ok: ${text.slice(0, 200)}`);
}

async function countCallsByStamp(siteId, stamp) {
  const { data, error } = await supabase
    .from('calls')
    .select('id, intent_action, intent_target, intent_stamp, created_at')
    .eq('site_id', siteId)
    .eq('intent_stamp', stamp)
    .limit(10);
  if (error) throw error;
  return data || [];
}

async function listCallsForSession(siteId, sessionId, limit = 10) {
  const { data, error } = await supabase
    .from('calls')
    .select('id, intent_action, intent_target, intent_stamp, created_at, source')
    .eq('site_id', siteId)
    .eq('matched_session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function main() {
  console.log('🧪 stamp-idempotency-proof');
  console.log(JSON.stringify({ SYNC_API_URL, ORIGIN }, null, 2));

  const { site_id: internalSiteId, site_public_id } = await pickSitePublicId();
  const sm = monthKeyUTC();

  // Test 1: whatsapp WITHOUT intent_stamp (server fallback stamp must be present)
  const sessionNoStamp = generateUUID();
  await postSync({
    s: site_public_id,
    u: `https://example.test/landing?gclid=TEST`,
    sid: sessionNoStamp,
    sm,
    ec: 'conversion',
    ea: 'whatsapp',
    el: 'https://web.whatsapp.com/send?phone=05321796834&text=hi',
    ev: null,
    r: 'https://google.com/',
    meta: { fp: 'fp_stamp_nostamp', gclid: 'TEST', intent_action: 'whatsapp' },
  });

  await sleep(700);
  const rowsNoStamp = await listCallsForSession(internalSiteId, sessionNoStamp, 5);
  console.log('## SQL output rows (no intent_stamp => server generated)');
  console.log(JSON.stringify({ sessionId: sessionNoStamp, rows: rowsNoStamp }, null, 2));
  const created = rowsNoStamp.find((r) => r.source === 'click');
  if (!created) throw new Error('expected a click calls row for no-stamp test');
  if (!created.intent_stamp) throw new Error('expected server-generated intent_stamp');
  if (created.intent_action !== 'whatsapp') throw new Error(`expected intent_action=whatsapp, got ${created.intent_action}`);
  if (!String(created.intent_target || '').startsWith('wa:')) throw new Error(`expected intent_target to start with wa:, got ${created.intent_target}`);

  // Test 2: duplicate whatsapp with same stamp (messy URL) => 1 row
  const sessionId1 = generateUUID();
  const stampWa = `teststamp-${Date.now()}-wa-abcdef`;
  const base = {
    s: site_public_id,
    u: `https://example.test/landing?gclid=TEST`,
    sid: sessionId1,
    sm,
    ec: 'conversion',
    el: 'https://web.whatsapp.com/send?phone=05321796834&text=hi',
    ev: null,
    r: 'https://google.com/',
    meta: { fp: 'fp_stamp_test', gclid: 'TEST', intent_stamp: stampWa, intent_action: 'whatsapp' },
  };
  await postSync({ ...base, ea: 'whatsapp' });
  await postSync({ ...base, ea: 'whatsapp' });

  await sleep(700);
  const rows1 = await countCallsByStamp(internalSiteId, stampWa);
  console.log('## SQL output rows (same stamp twice)');
  console.log(JSON.stringify({ stamp: stampWa, rows: rows1 }, null, 2));
  if (rows1.length !== 1) throw new Error(`expected 1 calls row for same stamp, got ${rows1.length}`);
  if (rows1[0]?.intent_action !== 'whatsapp') throw new Error(`expected intent_action=whatsapp, got ${rows1[0]?.intent_action}`);
  if (!String(rows1[0]?.intent_target || '').startsWith('wa:')) throw new Error(`expected wa: target, got ${rows1[0]?.intent_target}`);

  // Test 3: tel then whatsapp within 5 seconds => 2 rows (different intent_action + prefixes)
  const sessionId2 = generateUUID();
  const stampTel = `teststamp-${Date.now()}-tel-bbbbbb`;
  const stampWa2 = `teststamp-${Date.now()}-wa-aaaaaa`;

  await postSync({
    s: site_public_id,
    u: `https://example.test/landing?gclid=TEST`,
    sid: sessionId2,
    sm,
    ec: 'conversion',
    ea: 'phone_call',
    el: 'tel:05321796834',
    ev: null,
    r: 'https://google.com/',
    meta: { fp: 'fp_stamp_test2', gclid: 'TEST', intent_stamp: stampTel, intent_action: 'phone_call' },
  });

  await postSync({
    s: site_public_id,
    u: `https://example.test/landing?gclid=TEST`,
    sid: sessionId2,
    sm,
    ec: 'conversion',
    ea: 'whatsapp',
    el: 'https://wa.me/05321796834',
    ev: null,
    r: 'https://google.com/',
    meta: { fp: 'fp_stamp_test2', gclid: 'TEST', intent_stamp: stampWa2, intent_action: 'whatsapp' },
  });

  await sleep(700);
  const telRows = await countCallsByStamp(internalSiteId, stampTel);
  const wa2Rows = await countCallsByStamp(internalSiteId, stampWa2);
  console.log('## SQL output rows (tel then wa, by stamp)');
  console.log(JSON.stringify({ sessionId: sessionId2, tel: telRows, wa: wa2Rows }, null, 2));

  if (telRows.length !== 1) throw new Error(`expected 1 tel row for stamp=${stampTel}, got ${telRows.length}`);
  if (wa2Rows.length !== 1) throw new Error(`expected 1 wa row for stamp=${stampWa2}, got ${wa2Rows.length}`);
  if (telRows[0]?.intent_action !== 'phone') throw new Error(`expected intent_action=phone, got ${telRows[0]?.intent_action}`);
  if (wa2Rows[0]?.intent_action !== 'whatsapp') throw new Error(`expected intent_action=whatsapp, got ${wa2Rows[0]?.intent_action}`);
  if (!String(telRows[0]?.intent_target || '').startsWith('tel:')) throw new Error(`expected tel: target, got ${telRows[0]?.intent_target}`);
  if (!String(wa2Rows[0]?.intent_target || '').startsWith('wa:')) throw new Error(`expected wa: target, got ${wa2Rows[0]?.intent_target}`);

  // Test 4: invariants — intent_action only phone|whatsapp and targets start with tel:|wa:
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: last5, error: last5Err } = await supabase
    .from('calls')
    .select('created_at, intent_action, intent_target, intent_stamp, source')
    .eq('site_id', internalSiteId)
    .eq('source', 'click')
    .gte('created_at', fifteenMinAgo)
    .order('created_at', { ascending: false })
    .limit(5);
  if (last5Err) throw last5Err;
  console.log("## SQL output rows (latest 5 calls source='click' in last 15 min)");
  console.log(JSON.stringify(last5 || [], null, 2));

  const { data: allActions, error: allActionsErr } = await supabase
    .from('calls')
    .select('intent_action')
    .eq('site_id', internalSiteId)
    .eq('source', 'click')
    .gte('created_at', fifteenMinAgo)
    .limit(5000);
  if (allActionsErr) throw allActionsErr;
  const actionCounts = (allActions || []).reduce((acc, r) => {
    const k = r.intent_action || 'NULL';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  console.log("## SQL output rows (intent_action distribution, source='click' in last 15 min)");
  console.log(JSON.stringify(actionCounts, null, 2));
  const invalidActions = Object.keys(actionCounts).filter((k) => !['phone', 'whatsapp'].includes(k));
  if (invalidActions.length) throw new Error(`found non-canonical intent_action values: ${invalidActions.join(',')}`);

  // Informational (may include legacy rows before backfill migration runs)
  const { data: legacyActions, error: legacyActionsErr } = await supabase
    .from('calls')
    .select('intent_action')
    .eq('site_id', internalSiteId)
    .eq('source', 'click')
    .limit(5000);
  if (legacyActionsErr) throw legacyActionsErr;
  const legacyCounts = (legacyActions || []).reduce((acc, r) => {
    const k = r.intent_action || 'NULL';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  console.log("## SQL output rows (intent_action distribution, source='click' ALL — informational)");
  console.log(JSON.stringify(legacyCounts, null, 2));

  // Cleanup best-effort (delete by stamp)
  try { await supabase.from('calls').delete().eq('matched_session_id', sessionNoStamp); } catch {}
  try { await supabase.from('calls').delete().eq('intent_stamp', stampWa); } catch {}
  try { await supabase.from('calls').delete().in('intent_stamp', [stampWa2, stampTel]); } catch {}

  console.log('✅ PASS');
}

main().catch((err) => {
  console.error('❌ FAIL:', err?.message || err);
  process.exit(1);
});

