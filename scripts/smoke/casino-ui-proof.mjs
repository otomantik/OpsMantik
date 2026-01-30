/**
 * GO2 Casino UI — Seal API smoke (evde: proof user'ın sahibi olduğu sitede).
 * 1) Giriş yap; proof user'a ait site bul veya oluştur.
 * 2) O sitede intent call bul veya --inject / PROOF_INJECT_CALL=1 ile enjekte et.
 * 3) POST /api/calls/[id]/seal (Bearer) → sale_amount=1000, currency=TRY.
 * 4) DB: sale_amount=1000, status=confirmed doğrula.
 *
 * Gereksinim: app çalışıyor (npm run dev), .env.local (Supabase + PROOF_*).
 * Kullanım: node scripts/smoke/casino-ui-proof.mjs
 *          node scripts/smoke/casino-ui-proof.mjs --inject
 * PowerShell: $env:PROOF_INJECT_CALL='1'; node scripts/smoke/casino-ui-proof.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const OUT_DIR = path.join(process.cwd(), 'docs', 'WAR_ROOM', 'EVIDENCE', 'GO2_CASINO_UI');
const BASE_URL = process.env.PROOF_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROOF_EMAIL = process.env.PROOF_EMAIL || 'playwright-proof@opsmantik.local';
const PROOF_PASSWORD = process.env.PROOF_PASSWORD || 'ProofPass!12345';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (.env.local)');
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function getSession() {
  let { data, error } = await anon.auth.signInWithPassword({ email: PROOF_EMAIL, password: PROOF_PASSWORD });
  if (error) {
    await admin.auth.admin.createUser({ email: PROOF_EMAIL, password: PROOF_PASSWORD, email_confirm: true });
    const retry = await anon.auth.signInWithPassword({ email: PROOF_EMAIL, password: PROOF_PASSWORD });
    data = retry.data;
    error = retry.error;
  }
  if (error || !data?.session) throw new Error(`Auth failed: ${error?.message || 'unknown'}`);
  await admin.from('profiles').upsert({ id: data.session.user.id, role: 'admin' });
  return data.session;
}

/** Proof user'a ait site bul; yoksa oluştur. RLS'te sahibi olduğu sitede test yapıyoruz. */
async function getOrCreateOwnSite(adminClient, userId) {
  let { data: site } = await adminClient.from('sites').select('id').eq('user_id', userId).limit(1).maybeSingle();
  if (site?.id) return site.id;
  const { data: inserted, error } = await adminClient
    .from('sites')
    .insert({ user_id: userId, name: 'Smoke Test Site' })
    .select('id')
    .single();
  if (error) throw new Error(`Site oluşturulamadı: ${error.message}`);
  return inserted.id;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const argv = process.argv.slice(2);
const injectCall = process.env.PROOF_INJECT_CALL === '1' || process.env.PROOF_INJECT_CALL === 'true' || argv.includes('--inject');

// --- 1) Giriş + proof user'ın sahibi olduğu site ---
const session = await getSession();
const siteId = await getOrCreateOwnSite(admin, session.user.id);
console.log('Proof user id:', session.user.id);
console.log('Proof user site_id:', siteId);

// --- 2) Bu sitede intent call bul veya enjekte et ---
let callRow = null;
let callErr = null;
({ data: callRow, error: callErr } = await admin
  .from('calls')
  .select('id, site_id, status, sale_amount, currency')
  .eq('site_id', siteId)
  .or('status.eq.intent,status.is.null')
  .in('intent_action', ['phone', 'whatsapp'])
  .not('intent_target', 'is', null)
  .neq('intent_target', '')
  .not('intent_stamp', 'is', null)
  .neq('intent_stamp', '')
  .limit(1)
  .maybeSingle());

if (callErr) {
  console.error('DB error finding call:', callErr.message);
  process.exit(1);
}

if (!callRow?.id && injectCall) {
  const intentStamp = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { data: inserted, error: insertErr } = await admin
    .from('calls')
    .insert({
      site_id: siteId,
      phone_number: '+15550000000',
      status: 'intent',
      source: 'click',
      intent_action: 'phone',
      intent_target: '+15550000000',
      intent_stamp: intentStamp,
    })
    .select('id, site_id, status')
    .single();
  if (insertErr) {
    console.error('Insert test call failed:', insertErr.message);
    process.exit(1);
  }
  callRow = inserted;
  console.log('Injected test call id:', callRow.id);
}

if (!callRow?.id) {
  console.log('Bu sitede intent call yok; seal testi atlanıyor (veri yoksa PASS).');
  console.log('İpucu: PROOF_INJECT_CALL=1 ile test call oluştur.');
  fs.writeFileSync(path.join(OUT_DIR, 'smoke_log.txt'), 'No pending call for site; skip seal test.\n');
  process.exit(0);
}
const callId = callRow.id;
console.log('Test call id:', callId, 'call site_id:', callRow.site_id, 'status:', callRow.status);

// --- 3) Seal API (Bearer token; admin lookup + validateSiteAccess + user client UPDATE) ---
const apiUrl = `${BASE_URL}/api/calls/${callId}/seal`;
const res = await fetch(apiUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({ sale_amount: 1000, currency: 'TRY' }),
});
const body = await res.json().catch(() => ({}));

if (res.status !== 200) {
  console.error('Seal API failed:', res.status, body);
  fs.writeFileSync(path.join(OUT_DIR, 'smoke_log.txt'), `Seal API failed: ${res.status} ${JSON.stringify(body)}\n`);
  process.exit(1);
}
console.log('Seal API result:', JSON.stringify(body));

// --- 3) Verify DB row updated ---
const { data: updated, error: verifyErr } = await admin
  .from('calls')
  .select('id, sale_amount, currency, status, confirmed_at')
  .eq('id', callId)
  .single();

if (verifyErr || !updated) {
  console.error('Verify failed:', verifyErr?.message || 'no row');
  process.exit(1);
}
if (Number(updated.sale_amount) !== 1000 || (updated.status || '').toLowerCase() !== 'confirmed') {
  console.error('DB not updated: sale_amount=', updated.sale_amount, 'status=', updated.status);
  process.exit(1);
}
console.log('DB verified: sale_amount=1000, status=confirmed');

const log = `callId=${callId}\nseal API 200\nsale_amount=1000\nstatus=confirmed\n`;
fs.writeFileSync(path.join(OUT_DIR, 'smoke_log.txt'), log);
console.log('GO2 Casino UI smoke: PASS. Log:', path.join(OUT_DIR, 'smoke_log.txt'));
