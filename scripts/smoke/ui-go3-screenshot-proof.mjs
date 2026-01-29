import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const root = process.cwd();
const outDir = path.join(root, 'docs', 'WAR_ROOM', 'EVIDENCE', 'PHASE4_GO3');

const targetUrl =
  process.env.PROOF_URL ||
  'https://console.opsmantik.com/dashboard/site/01d24667-ca9a-44e3-ab7a-7cd171ae653f?tab=live';

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
  if (host === 'localhost' || host === '127.0.0.1') return host;
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
  const { error: profileError } = await admin.from('profiles').upsert({ id: userId, role: 'admin' });
  if (profileError) throw new Error(`Failed to ensure admin profile: ${profileError.message}`);

  return data.session;
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const shots = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
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

    // For localhost proofs, create a user-owned test site to ensure realtime RLS allows payloads.
    let effectiveUrl = targetUrl;
    try {
      const u0 = new URL(targetUrl);
      const shouldCreateSite =
        process.env.PROOF_USE_TEST_SITE !== '0' &&
        (u0.hostname === 'localhost' || u0.hostname === '127.0.0.1');
      if (shouldCreateSite) {
        const resp = await page.request.post(`${u0.origin}/api/create-test-site`);
        if (resp.ok()) {
          const j = await resp.json();
          const sid = j?.site?.id;
          if (sid) {
            effectiveUrl = `${u0.origin}/dashboard/site/${sid}?tab=live`;
          }
        }
      }
    } catch {
      // ignore
    }

    await page.goto(effectiveUrl, { waitUntil: 'networkidle', timeout: 60000 });
    if (page.url().includes('/login')) throw new Error('Auth cookie not accepted; redirected to /login');

    await page.locator('[data-testid="live-badge"]').waitFor({ timeout: 15000 });

    // "Before" (may be OFFLINE or LIVE depending on background traffic)
    const outBefore = path.join(outDir, `${shot.name}-before.png`);
    await page.screenshot({ path: outBefore, fullPage: true });
    console.log(`Saved ${outBefore}`);

    // Emit signal and wait for LIVE
    await page.waitForFunction(
      () => document.querySelector('[data-testid="live-badge"]')?.getAttribute('data-connected') === '1',
      null,
      { timeout: 15000 }
    );

    const u = new URL(page.url());
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'site');
    const siteId = idx >= 0 ? parts[idx + 1] : null;
    if (!siteId) throw new Error('Unable to parse siteId from URL');

    await page.request.post(`${u.origin}/api/debug/realtime-signal`, {
      data: { siteId, kind: 'calls' },
    });

    await page.waitForFunction(
      () => document.querySelector('[data-testid="live-badge"]')?.getAttribute('data-live') === '1',
      null,
      { timeout: 3000 }
    );

    const outAfter = path.join(outDir, `${shot.name}-after-live.png`);
    await page.screenshot({ path: outAfter, fullPage: true });
    console.log(`Saved ${outAfter}`);

    await context.close();
  }
} finally {
  await browser.close();
}

