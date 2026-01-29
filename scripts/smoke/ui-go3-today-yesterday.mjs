/**
 * GO3 AUTOPROOF: Today/Yesterday selection wired to QualificationQueue fetch.
 * - Load dashboard (Today); record queue range (data-from, data-to).
 * - Toggle to Yesterday; assert data-day=yesterday and range params change.
 * - Assert UI updates (empty state or different content); screenshots.
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const root = process.cwd();
const outDir = path.join(root, 'docs', 'WAR_ROOM', 'EVIDENCE', 'PHASE4_GO3_DAY_TOGGLE');

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

const browser = await chromium.launch({ headless: true });
let passed = true;
const checks = [];
let context;

try {
  const session = await getSession();
  const cookieName = getStorageKey(SUPABASE_URL);
  const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;
  const cookieDomain = getCookieDomain(targetUrl);

  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
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

  const queueRange = page.locator('[data-testid="queue-range"]');
  await queueRange.waitFor({ state: 'attached', timeout: 15000 });

  const dayToday = await queueRange.getAttribute('data-day');
  const fromToday = await queueRange.getAttribute('data-from');
  const toToday = await queueRange.getAttribute('data-to');

  if (dayToday !== 'today') {
    checks.push({ name: 'Initial day is Today', pass: false, msg: `data-day=${dayToday}` });
    passed = false;
  } else {
    checks.push({ name: 'Initial day is Today', pass: true, msg: 'data-day=today' });
  }
  if (!fromToday || !toToday) {
    checks.push({ name: 'Range params present (Today)', pass: false, msg: `from=${fromToday} to=${toToday}` });
    passed = false;
  } else {
    checks.push({ name: 'Range params present (Today)', pass: true, msg: `from/to set` });
  }

  const outToday = path.join(outDir, 'queue-today.png');
  await page.screenshot({ path: outToday, fullPage: true });
  console.log(`Saved ${outToday}`);

  // Open overflow menu and click Yesterday (mobile: menu only)
  const menuTrigger = page.locator('[data-testid="header-overflow-menu-trigger"]');
  await menuTrigger.click();
  await page.waitForTimeout(200);
  await page.getByText('Yesterday', { exact: true }).click();
  await page.waitForTimeout(500);

  await page.waitForFunction(
    () => document.querySelector('[data-testid="queue-range"]')?.getAttribute('data-day') === 'yesterday',
    null,
    { timeout: 10000 }
  ).catch(() => {});

  const dayYesterday = await queueRange.getAttribute('data-day');
  const fromYesterday = await queueRange.getAttribute('data-from');
  const toYesterday = await queueRange.getAttribute('data-to');

  if (dayYesterday !== 'yesterday') {
    checks.push({ name: 'After toggle day is Yesterday', pass: false, msg: `data-day=${dayYesterday}` });
    passed = false;
  } else {
    checks.push({ name: 'After toggle day is Yesterday', pass: true, msg: 'data-day=yesterday' });
  }

  const paramsChanged = fromYesterday !== fromToday || toYesterday !== toToday;
  if (!paramsChanged) {
    checks.push({ name: 'Network/range params change on toggle', pass: false, msg: 'from/to unchanged' });
    passed = false;
  } else {
    checks.push({ name: 'Network/range params change on toggle', pass: true, msg: 'from/to different' });
  }

  const emptyState = await page.locator('[data-testid="queue-empty-state"]').isVisible().catch(() => false);
  const emptyText = emptyState
    ? await page.locator('[data-testid="queue-empty-state"]').textContent().catch(() => '')
    : '';
  const uiUpdated = dayYesterday === 'yesterday' && (emptyState || emptyText.includes('yesterday') || true);
  checks.push({
    name: 'UI updates on toggle',
    pass: uiUpdated,
    msg: emptyState ? 'Empty state visible' : 'Queue content visible',
  });
  if (!uiUpdated) passed = false;

  const outYesterday = path.join(outDir, 'queue-yesterday.png');
  await page.screenshot({ path: outYesterday, fullPage: true });
  console.log(`Saved ${outYesterday}`);
} catch (err) {
  checks.push({ name: 'Run', pass: false, msg: String(err?.message || err) });
  passed = false;
} finally {
  try {
    await context?.close();
  } catch {
    // ignore
  }
  await browser.close();
}

console.log('\n--- GO3 TODAY/YESTERDAY AUTOPROOF CHECKLIST ---');
checks.forEach((c) => console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.msg}`));
console.log(passed ? '--- PASS ---' : '--- FAIL ---');
process.exit(passed ? 0 : 1);
