/**
 * GO_1 AUTOPROOF: Capture desktop + mobile screenshots to docs/_archive/2026-02-02/WAR_ROOM/EVIDENCE/GO_1/
 * Requires: app running (npm run start or npm run dev), .env.local with Supabase + PROOF_*.
 * Usage: node scripts/smoke/go1-screenshots.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const OUT_DIR = path.join(process.cwd(), 'docs', '_archive', '2026-02-02', 'WAR_ROOM', 'EVIDENCE', 'GO_1');
const BASE_URL = process.env.PROOF_URL || 'http://localhost:3000';
const DASHBOARD_PATH = process.env.PROOF_DASHBOARD_PATH || '/dashboard/site/00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROOF_EMAIL = process.env.PROOF_EMAIL || 'playwright-proof@opsmantik.local';
const PROOF_PASSWORD = process.env.PROOF_PASSWORD || 'ProofPass!12345';

async function getSession() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE env vars');
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
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

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getStorageKey(url) {
  const ref = new URL(url).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

function getCookieDomain(url) {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' ? host : '.opsmantik.com';
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const session = await getSession();
const cookieName = getStorageKey(BASE_URL);
const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;
const cookieDomain = getCookieDomain(BASE_URL);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

async function capture(name, viewport) {
  const ctx = await browser.newContext({
    viewport,
    storageState: undefined,
  });
  await ctx.addCookies([{
    name: cookieName,
    value: cookieValue,
    domain: cookieDomain,
    path: '/',
    httpOnly: false,
    secure: cookieDomain !== 'localhost' && cookieDomain !== '127.0.0.1',
    sameSite: 'Lax',
  }]);
  const page = await ctx.newPage();
  await page.goto(BASE_URL + DASHBOARD_PATH, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  const outPath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: outPath, fullPage: false });
  await ctx.close();
  console.log('Saved:', outPath);
}

await capture('desktop', { width: 1440, height: 900 });
await capture('mobile', { width: 390, height: 844 });

await browser.close();
console.log('GO_1 screenshots done.');
