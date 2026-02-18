import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

/**
 * RLS Proof Pack (NO service role):
 *
 * Required env (CI):
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - TEST_USER_EMAIL
 * - TEST_USER_PASSWORD
 *
 * Optional (recommended to avoid + addressing):
 * - TEST_USER_EMAIL_B
 * - TEST_USER_PASSWORD_B
 *
 * Skip behavior:
 * - If required env is missing OR auth sign-in cannot produce a session, the test is skipped (not failed).
 *
 * What this proves:
 * - With auth.uid() context, userA can only read their own tenant rows (siteA) even if querying by IDs.
 * - userA cannot INSERT rows into siteB (RLS violation).
 */

// Best-effort local dev support: load env from repo root without requiring shell export.
// CI should still set the required env vars explicitly.
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  TEST_USER_EMAIL: string;
  TEST_USER_PASSWORD: string;
  TEST_USER_EMAIL_B: string | null;
  TEST_USER_PASSWORD_B: string | null;
};

function envFirst(...keys: string[]) {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && String(v).trim() !== '') return String(v);
  }
  return null;
}

function readRequiredEnv(): { ok: true; env: Env } | { ok: false; missing: string[] } {
  const supabaseUrl = envFirst('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const supabaseAnonKey = envFirst('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const testUserEmail = envFirst('TEST_USER_EMAIL');
  const testUserPassword = envFirst('TEST_USER_PASSWORD');
  const testUserEmailB = envFirst('TEST_USER_EMAIL_B');
  const testUserPasswordB = envFirst('TEST_USER_PASSWORD_B');

  const missing: string[] = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
  if (!supabaseAnonKey) missing.push('SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)');
  if (!testUserEmail) missing.push('TEST_USER_EMAIL');
  if (!testUserPassword) missing.push('TEST_USER_PASSWORD');
  if (missing.length) return { ok: false, missing };

  return {
    ok: true,
    env: {
      SUPABASE_URL: supabaseUrl as string,
      SUPABASE_ANON_KEY: supabaseAnonKey as string,
      TEST_USER_EMAIL: testUserEmail as string,
      TEST_USER_PASSWORD: testUserPassword as string,
      TEST_USER_EMAIL_B: testUserEmailB,
      TEST_USER_PASSWORD_B: testUserPasswordB,
    },
  };
}

function plusAddress(email: string, tag: string) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local}+${tag}@${domain}`;
}

function monthStartUTC(d = new Date()) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  return dt.toISOString().slice(0, 10); // YYYY-MM-01
}

function hex32() {
  return crypto.randomBytes(16).toString('hex'); // 32 hex chars
}

function mkClient(url: string, anonKey: string) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signInWithPasswordOrSkip(client: SupabaseClient, email: string, password: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return { ok: false as const, reason: `signIn failed for ${email}: ${error?.message || 'no session'}` };
  }
  return { ok: true as const };
}

async function signInClient(
  url: string,
  anonKey: string,
  email: string,
  password: string
): Promise<{ ok: true; client: SupabaseClient } | { ok: false; reason: string }> {
  const client = mkClient(url, anonKey);
  const si = await signInWithPasswordOrSkip(client, email, password);
  if (!si.ok) return { ok: false, reason: si.reason };
  return { ok: true, client };
}

async function authedUserId(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.id) throw new Error(`auth.getUser failed: ${error?.message || 'no user'}`);
  return data.user.id;
}

test('RLS proof pack: tenant isolation under auth.uid() (no service role)', async (t) => {
  const envRes = readRequiredEnv();
  if (!envRes.ok) {
    t.skip(`Missing env: ${envRes.missing.join(', ')}`);
    return;
  }
  const env = envRes.env;

  const userAEmail = env.TEST_USER_EMAIL;
  const userBEmail = env.TEST_USER_EMAIL_B ?? plusAddress(env.TEST_USER_EMAIL, 'rls-b');
  const userAPassword = env.TEST_USER_PASSWORD;
  const userBPassword = env.TEST_USER_PASSWORD_B ?? env.TEST_USER_PASSWORD;

  const userARes = await signInClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, userAEmail, userAPassword);
  if (!userARes.ok) {
    t.skip(userARes.reason);
    return;
  }

  const userBRes = await signInClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, userBEmail, userBPassword);
  if (!userBRes.ok) {
    t.skip(userBRes.reason);
    return;
  }

  const userA = userARes.client;
  const userB = userBRes.client;

  const userAId = await authedUserId(userA);
  const userBId = await authedUserId(userB);

  const label = `rls_proof_${Date.now()}_${hex32().slice(0, 8)}`;
  const createdMonth = monthStartUTC();

  // Create two sites owned by different users (true tenant boundary proof).
  const siteA = {
    user_id: userAId,
    public_id: hex32(),
    domain: `rls-a-${hex32().slice(0, 8)}.example.com`,
    name: `RLS Proof A (${label})`,
  };
  const siteB = {
    user_id: userBId,
    public_id: hex32(),
    domain: `rls-b-${hex32().slice(0, 8)}.example.com`,
    name: `RLS Proof B (${label})`,
  };
  const siteBNameOriginal = siteB.name;

  const createdAt = new Date().toISOString();
  const sessionAId = crypto.randomUUID();
  const sessionBId = crypto.randomUUID();

  // Track created resources for cleanup.
  const cleanup = async () => {
    // Delete events then sessions then sites (best-effort, ignore errors to avoid masking the real assertion failure).
    await userA.from('events').delete().eq('session_id', sessionAId).eq('session_month', createdMonth);
    await userB.from('events').delete().eq('session_id', sessionBId).eq('session_month', createdMonth);
    await userA.from('sessions').delete().eq('id', sessionAId).eq('created_month', createdMonth);
    await userB.from('sessions').delete().eq('id', sessionBId).eq('created_month', createdMonth);
    await userA.from('sites').delete().eq('domain', siteA.domain);
    await userB.from('sites').delete().eq('domain', siteB.domain);
  };
  t.after(cleanup);

  // 1) Create sites
  const { data: insSiteA, error: insSiteAErr } = await userA.from('sites').insert(siteA).select('id').single();
  assert.ok(!insSiteAErr, `siteA insert error: ${insSiteAErr?.message}`);
  assert.ok(insSiteA?.id, 'siteA insert returned no id');

  const { data: insSiteB, error: insSiteBErr } = await userB.from('sites').insert(siteB).select('id').single();
  assert.ok(!insSiteBErr, `siteB insert error: ${insSiteBErr?.message}`);
  assert.ok(insSiteB?.id, 'siteB insert returned no id');

  const siteAId = insSiteA.id as string;
  const siteBId = insSiteB.id as string;
  assert.notEqual(siteAId, siteBId);

  // 2) Insert sessions/events for both sites using their respective authenticated contexts (NO service role)
  const sessPayloadA = {
    id: sessionAId,
    site_id: siteAId,
    created_month: createdMonth,
    created_at: createdAt,
    entry_page: '/rls-proof',
    attribution_source: label,
    fingerprint: `fp-${label}`,
  };
  const sessPayloadB = {
    id: sessionBId,
    site_id: siteBId,
    created_month: createdMonth,
    created_at: createdAt,
    entry_page: '/rls-proof',
    attribution_source: label,
    fingerprint: `fp-${label}`,
  };

  const { error: insSessAErr } = await userA.from('sessions').insert(sessPayloadA);
  assert.ok(!insSessAErr, `sessionA insert error (expected allowed for owner): ${insSessAErr?.message}`);

  const { error: insSessBErr } = await userB.from('sessions').insert(sessPayloadB);
  assert.ok(!insSessBErr, `sessionB insert error (expected allowed for owner): ${insSessBErr?.message}`);

  const evPayloadA = {
    session_id: sessionAId,
    session_month: createdMonth,
    url: 'https://example.com/rls-proof',
    event_category: 'interaction',
    event_action: 'view',
    metadata: { label, site_hint: 'A' },
    created_at: createdAt,
  };
  const evPayloadB = {
    session_id: sessionBId,
    session_month: createdMonth,
    url: 'https://example.com/rls-proof',
    event_category: 'interaction',
    event_action: 'view',
    metadata: { label, site_hint: 'B' },
    created_at: createdAt,
  };

  const { error: insEvAErr } = await userA.from('events').insert(evPayloadA);
  assert.ok(!insEvAErr, `eventA insert error: ${insEvAErr?.message}`);

  const { error: insEvBErr } = await userB.from('events').insert(evPayloadB);
  assert.ok(!insEvBErr, `eventB insert error: ${insEvBErr?.message}`);

  // 3) Assert: Reading sessions/events in userA context only returns siteA rows (RLS filters out siteB)
  const { data: sessionsForA, error: readSessErr } = await userA
    .from('sessions')
    .select('id, site_id, created_month')
    .eq('created_month', createdMonth)
    .in('id', [sessionAId, sessionBId]);
  assert.ok(!readSessErr, `sessions read error: ${readSessErr?.message}`);
  assert.ok(Array.isArray(sessionsForA));
  assert.equal(sessionsForA.length, 1, 'userA should only see 1 session (siteA)');
  assert.equal(sessionsForA[0]?.id, sessionAId);
  assert.equal(sessionsForA[0]?.site_id, siteAId);

  // Events query must be index/partition friendly under RLS.
  // Avoid scanning by metadata filters; instead, query by session_id + session_month.
  const { data: eventsA, error: readEvAErr } = await userA
    .from('events')
    .select('session_id, session_month')
    .eq('session_id', sessionAId)
    .eq('session_month', createdMonth)
    .limit(5);
  assert.ok(!readEvAErr, `events read (siteA) error: ${readEvAErr?.message}`);
  assert.ok(Array.isArray(eventsA));
  assert.equal(eventsA.length, 1, 'userA should see 1 event for siteA session');
  assert.equal(eventsA[0]?.session_id, sessionAId);

  const { data: eventsB, error: readEvBErr } = await userA
    .from('events')
    .select('session_id, session_month')
    .eq('session_id', sessionBId)
    .eq('session_month', createdMonth)
    .limit(5);
  assert.ok(!readEvBErr, `events read (siteB) error: ${readEvBErr?.message}`);
  assert.ok(Array.isArray(eventsB));
  assert.equal(eventsB.length, 0, 'userA must not see any events for siteB session (RLS)');

  // 4) Assert: Attempt to insert into siteB using userA context fails (RLS / 403)
  const forbiddenSessionId = crypto.randomUUID();
  const { error: forbiddenInsErr } = await userA.from('sessions').insert({
    id: forbiddenSessionId,
    site_id: siteBId,
    created_month: createdMonth,
    created_at: createdAt,
    entry_page: '/rls-proof-forbidden',
    attribution_source: label,
  });
  assert.ok(forbiddenInsErr, 'expected insert into siteB from userA to fail (RLS)');

  // 5) Assert: Attempt to UPDATE siteB using userA context cannot modify tenant B data.
  const hackedName = `HACKED (${label})`;
  const { data: updRows, error: updErr } = await userA
    .from('sites')
    .update({ name: hackedName })
    .eq('id', siteBId)
    .select('id, name');

  // Some PostgREST/RLS configs return empty array rather than an error; treat either as "blocked".
  assert.ok(updErr || (Array.isArray(updRows) && updRows.length === 0), 'expected update of siteB from userA to be blocked by RLS');

  const { data: siteBSeenByB, error: readSiteBErr } = await userB.from('sites').select('id, name').eq('id', siteBId).single();
  assert.ok(!readSiteBErr, `userB should read own siteB: ${readSiteBErr?.message}`);
  assert.equal(siteBSeenByB?.name, siteBNameOriginal, 'siteB name must remain unchanged after blocked update attempt');
});

