/**
 * GO1 AUTOPROOF: Mobile header overflow fix + overflow menu.
 * - Viewport 390x844 (mobile)
 * - Assert no horizontal scroll
 * - Open overflow menu, assert menu contains Day + Scope + (optional) Settings
 * - Screenshot to docs/_archive/2026-02-02/WAR_ROOM/EVIDENCE/PHASE4_GO1
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const root = process.cwd();
const outDir = path.join(root, 'docs', '_archive', '2026-02-02', 'WAR_ROOM', 'EVIDENCE', 'PHASE4_GO1');

const targetUrl =
  process.env.PROOF_URL ||
  'https://console.opsmantik.com/dashboard/site/01d24667-ca9a-44e3-ab7a-7cd171ae653f';

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

const MOBILE_VIEWPORT = { width: 390, height: 844 };

const browser = await chromium.launch({ headless: true });
let passed = true;
const checks = [];

try {
  const session = await getSession();
  const cookieName = getStorageKey(SUPABASE_URL);
  const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;
  const cookieDomain = getCookieDomain(targetUrl);

  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
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
        if (sid) effectiveUrl = `${u0.origin}/dashboard/site/${sid}`;
      }
    }
  } catch {
    // ignore
  }

  await page.goto(effectiveUrl, { waitUntil: 'networkidle', timeout: 60000 });
  if (page.url().includes('/login')) {
    checks.push({ name: 'Auth', pass: false, msg: 'Redirected to /login' });
    passed = false;
  } else {
    checks.push({ name: 'Auth', pass: true, msg: 'On dashboard' });
  }

  await page.locator('[data-testid="live-badge"]').waitFor({ timeout: 15000 }).catch(() => {});

  // 1) No horizontal scroll (mobile)
  const scrollResult = await page.evaluate((vw) => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body?.scrollWidth ?? 0);
    return { scrollWidth, viewportWidth: vw, ok: scrollWidth <= vw + 2 };
  }, MOBILE_VIEWPORT.width);
  if (!scrollResult.ok) {
    checks.push({
      name: 'No horizontal scroll',
      pass: false,
      msg: `scrollWidth=${scrollResult.scrollWidth} > viewport=${scrollResult.viewportWidth}`,
    });
    passed = false;
  } else {
    checks.push({ name: 'No horizontal scroll', pass: true, msg: `scrollWidth=${scrollResult.scrollWidth}` });
  }

  // 2) Overflow menu opens and contains items
  const menuTrigger = page.locator('[data-testid="header-overflow-menu-trigger"]');
  await menuTrigger.waitFor({ state: 'visible', timeout: 5000 });
  await menuTrigger.click();
  await page.waitForTimeout(300);

  const menuContent = page.locator('[data-testid="header-overflow-menu-content"]');
  const menuVisible = await menuContent.isVisible().catch(() => false);
  if (!menuVisible) {
    checks.push({ name: 'Menu opens', pass: false, msg: 'Menu content not visible' });
    passed = false;
  } else {
    checks.push({ name: 'Menu opens', pass: true, msg: 'Menu content visible' });
  }

  const hasYesterday = await page.getByText('Yesterday', { exact: true }).isVisible().catch(() => false);
  const hasToday = await page.getByText('Today', { exact: true }).isVisible().catch(() => false);
  const hasAdsOnly = await page.getByText('ADS ONLY', { exact: true }).isVisible().catch(() => false);
  const hasAllTraffic = await page.getByText('ALL TRAFFIC', { exact: true }).isVisible().catch(() => false);
  const hasSettings = await page.locator('[data-testid="menu-item-settings"]').isVisible().catch(() => false);

  if (!hasYesterday || !hasToday || !hasAdsOnly || !hasAllTraffic) {
    checks.push({
      name: 'Menu items',
      pass: false,
      msg: `Day/Scope items: Yesterday=${hasYesterday} Today=${hasToday} ADS=${hasAdsOnly} ALL=${hasAllTraffic}`,
    });
    passed = false;
  } else {
    checks.push({
      name: 'Menu items',
      pass: true,
      msg: `Day + Scope + Settings(${hasSettings})`,
    });
  }

  const screenshotPath = path.join(outDir, 'mobile-390x844-header-menu.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Saved ${screenshotPath}`);

  await context.close();
} catch (err) {
  checks.push({ name: 'Run', pass: false, msg: String(err?.message || err) });
  passed = false;
} finally {
  await browser.close();
}

console.log('\n--- GO1 AUTOPROOF CHECKLIST ---');
checks.forEach((c) => console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.msg}`));
console.log(passed ? '--- PASS ---' : '--- FAIL ---');
process.exit(passed ? 0 : 1);
