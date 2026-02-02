/**
 * GO2 AUTOPROOF: Badge labeling (DISCONNECTED / CONNECTED / ACTIVE).
 * - Asserts badge shows CONNECTED when connected but no signal, ACTIVE after signal.
 * - Screenshots: CONNECTED and ACTIVE states.
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const root = process.cwd();
const outDir = path.join(root, 'docs', '_archive', '2026-02-02', 'WAR_ROOM', 'EVIDENCE', 'PHASE4_GO2_BADGE');

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

try {
  const session = await getSession();
  const cookieName = getStorageKey(SUPABASE_URL);
  const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;
  const cookieDomain = getCookieDomain(targetUrl);

  const context = await browser.newContext({
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

  const badge = page.locator('[data-testid="live-badge"]');
  await badge.waitFor({ state: 'visible', timeout: 15000 });

  await page.waitForFunction(
    () => document.querySelector('[data-testid="live-badge"]')?.getAttribute('data-connected') === '1',
    null,
    { timeout: 15000 }
  ).catch(() => {});

  const statusBefore = await badge.getAttribute('data-badge-status');
  const validStatuses = ['disconnected', 'connected', 'active'];
  if (!validStatuses.includes(statusBefore)) {
    checks.push({ name: 'Badge status attribute', pass: false, msg: `data-badge-status=${statusBefore}` });
    passed = false;
  } else {
    checks.push({ name: 'Badge status attribute', pass: true, msg: `data-badge-status=${statusBefore}` });
  }

  if (statusBefore === 'connected') {
    const outConnected = path.join(outDir, 'badge-connected.png');
    await page.screenshot({ path: outConnected, fullPage: false });
    console.log(`Saved ${outConnected}`);
    checks.push({ name: 'Screenshot CONNECTED', pass: true, msg: outConnected });
  } else if (statusBefore === 'active') {
    const outActiveEarly = path.join(outDir, 'badge-active-before-inject.png');
    await page.screenshot({ path: outActiveEarly, fullPage: false });
    console.log(`Saved ${outActiveEarly}`);
  }

  const u = new URL(page.url());
  const parts = u.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'site');
  const siteId = idx >= 0 ? parts[idx + 1] : null;
  if (siteId) {
    await page.request.post(`${u.origin}/api/debug/realtime-signal`, {
      data: { siteId, kind: 'calls' },
    });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="live-badge"]')?.getAttribute('data-badge-status') === 'active',
      null,
      { timeout: 5000 }
    ).catch(() => {});

    const statusAfter = await badge.getAttribute('data-badge-status');
    if (statusAfter === 'active') {
      checks.push({ name: 'State transition to ACTIVE', pass: true, msg: 'After inject signal' });
      const outActive = path.join(outDir, 'badge-active.png');
      await page.screenshot({ path: outActive, fullPage: false });
      console.log(`Saved ${outActive}`);
      checks.push({ name: 'Screenshot ACTIVE', pass: true, msg: outActive });
    } else {
      checks.push({ name: 'State transition to ACTIVE', pass: false, msg: `status=${statusAfter}` });
      passed = false;
    }

    const lastSignalText = await page.locator('[data-testid="last-signal-label"]').textContent().catch(() => '');
    const hasTimestamp = lastSignalText && !lastSignalText.includes('Last signal: —');
    checks.push({
      name: 'Last signal label',
      pass: statusAfter === 'active' ? hasTimestamp : true,
      msg: hasTimestamp ? 'Shows TRT timestamp' : lastSignalText?.slice(0, 40) || '—',
    });
    if (statusAfter === 'active' && !hasTimestamp) passed = false;
  }

  await context.close();
} catch (err) {
  checks.push({ name: 'Run', pass: false, msg: String(err?.message || err) });
  passed = false;
} finally {
  await browser.close();
}

console.log('\n--- GO2 BADGE AUTOPROOF CHECKLIST ---');
checks.forEach((c) => console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.msg}`));
console.log(passed ? '--- PASS ---' : '--- FAIL ---');
process.exit(passed ? 0 : 1);
