import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const root = process.cwd();
const outDir = path.join(root, 'docs', '_archive', '2026-02-02', 'WAR_ROOM', 'EVIDENCE', 'PHASE4_GO1');
const targetUrl =
  process.env.PROOF_URL ||
  'https://console.opsmantik.com/dashboard/site/01d24667-ca9a-44e3-ab7a-7cd171ae653f?from=2026-01-28T21:00:00.000Z&to=2026-01-29T21:00:00.000Z';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROOF_EMAIL = process.env.PROOF_EMAIL || 'playwright-proof@opsmantik.local';
const PROOF_PASSWORD = process.env.PROOF_PASSWORD || 'ProofPass!12345';

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getStorageKey(url) {
  const host = new URL(url).hostname;
  const ref = host.split('.')[0];
  return `sb-${ref}-auth-token`;
}

function getCookieDomain(pageUrl) {
  const host = new URL(pageUrl).hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return host;
  }
  return '.opsmantik.com';
}

async function getSession() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE env vars for Playwright auth');
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
    throw new Error(`Failed to authenticate Playwright user: ${error?.message || 'unknown error'}`);
  }

  const userId = data.session.user.id;
  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: userId, role: 'admin' });

  if (profileError) {
    throw new Error(`Failed to ensure admin profile: ${profileError.message}`);
  }

  return data.session;
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const shots = [
  { name: 'desktop-1440x900.png', width: 1440, height: 900 },
  { name: 'mobile-390x844.png', width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true });
try {
  const session = await getSession();
  const cookieName = getStorageKey(SUPABASE_URL);
  const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;
  const cookieDomain = getCookieDomain(targetUrl);

  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
    });
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        domain: cookieDomain,
        path: '/',
        httpOnly: false,
        secure: cookieDomain !== 'localhost' && cookieDomain !== '127.0.0.1',
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    if (page.url().includes('/login')) {
      throw new Error('Auth cookie not accepted; redirected to /login');
    }
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('heading', { name: 'Settings' }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    const outPath = path.join(outDir, shot.name);
    await page.screenshot({ path: outPath, fullPage: true });
    await context.close();
    console.log(`Saved ${outPath}`);
  }
} finally {
  await browser.close();
}
