/**
 * P4-3.2 — Save Playwright auth state (no addCookies).
 * Programmatic login via Supabase signInWithPassword, inject session into browser via document.cookie,
 * then save context.storageState for reuse by p4-ui-screenshot and p4-3-screenshot.
 *
 * Requires: app running (npm run dev/start), .env.local with SupABASE + PROOF_EMAIL, PROOF_PASSWORD.
 * Env: PROOF_STORAGE_STATE (default: docs/WAR_ROOM/EVIDENCE/auth/auth-state.json), PROOF_URL.
 * Usage: node scripts/smoke/auth-login-save-state.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const BASE_URL = process.env.PROOF_URL || 'http://localhost:3000';
const STATE_DIR = path.join(process.cwd(), 'docs', 'WAR_ROOM', 'EVIDENCE', 'auth');
const PROOF_STORAGE_STATE = process.env.PROOF_STORAGE_STATE || path.join(STATE_DIR, 'auth-state.json');
const LOGIN_FAIL_SCREENSHOT = path.join(STATE_DIR, 'login-fail.png');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROOF_EMAIL = process.env.PROOF_EMAIL || 'playwright-proof@opsmantik.local';
const PROOF_PASSWORD = process.env.PROOF_PASSWORD || 'ProofPass!12345';

async function getSession() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE env vars');
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let { data, error } = await anon.auth.signInWithPassword({
    email: PROOF_EMAIL,
    password: PROOF_PASSWORD,
  });
  if (error) {
    await admin.auth.admin.createUser({
      email: PROOF_EMAIL,
      password: PROOF_PASSWORD,
      email_confirm: true,
    });
    const retry = await anon.auth.signInWithPassword({
      email: PROOF_EMAIL,
      password: PROOF_PASSWORD,
    });
    data = retry.data;
    error = retry.error;
  }
  if (error || !data?.session) {
    throw new Error(`Auth failed: ${error?.message || 'unknown'}`);
  }
  await admin.from('profiles').upsert({ id: data.session.user.id, role: 'admin' });
  return data.session;
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

fs.mkdirSync(path.dirname(PROOF_STORAGE_STATE), { recursive: true });

const session = await getSession();
const cookieName = 'supabase.auth.token';
const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;
const isSecure = BASE_URL.startsWith('https');
const cookieStr = `${cookieName}=${cookieValue}; path=/; max-age=86400; SameSite=Lax${isSecure ? '; Secure' : ''}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 900 },
  baseURL: BASE_URL,
});

const page = await context.newPage();

try {
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle', timeout: 20000 });
  await page.evaluate((str) => {
    document.cookie = str;
  }, cookieStr);
  await page.goto(BASE_URL + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 });
  const url = page.url();
  if (url.includes('/login') && !url.includes('/auth/callback')) {
    throw new Error('Still on login after inject');
  }
  await context.storageState({ path: PROOF_STORAGE_STATE });
  console.log('AUTH STATE SAVED:', PROOF_STORAGE_STATE);
  process.exit(0);
} catch (err) {
  fs.mkdirSync(path.dirname(LOGIN_FAIL_SCREENSHOT), { recursive: true });
  await page.screenshot({ path: LOGIN_FAIL_SCREENSHOT, fullPage: true }).catch(() => {});
  console.error('auth-login-save-state FAIL:', err.message);
  process.exit(1);
} finally {
  await context.close();
  await browser.close();
}
