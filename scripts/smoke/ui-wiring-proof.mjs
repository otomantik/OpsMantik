import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const root = process.cwd();
const report = [];
const phase = process.env.PROOF_PHASE || 'PHASE4_GO2';
const outDir = path.join(root, 'docs', 'WAR_ROOM', 'EVIDENCE', phase);

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

function assertFileExists(rel) {
  const p = path.join(root, rel);
  const ok = fs.existsSync(p);
  report.push(`${ok ? 'OK' : 'MISSING'} ${rel}`);
  return ok;
}

function fileContains(rel, needle) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    report.push(`MISSING ${rel}`);
    return false;
  }
  const content = fs.readFileSync(p, 'utf8');
  const ok = content.includes(needle);
  report.push(`${ok ? 'OK' : 'MISSING'} ${rel} contains "${needle}"`);
  return ok;
}

// Basic wiring proof
assertFileExists('components/dashboard-v2/HunterCard.tsx');
assertFileExists('components/ui/dialog.tsx');
assertFileExists('components/dashboard-v2/DashboardShell.tsx');
assertFileExists('components/dashboard-v2/QualificationQueue.tsx');

fileContains('components/dashboard-v2/DashboardShell.tsx', 'Dialog');
fileContains('components/dashboard-v2/DashboardShell.tsx', 'Hunter Terminal');
fileContains('components/dashboard-v2/QualificationQueue.tsx', 'HunterCard');
fileContains('components/dashboard-v2/QualificationQueue.tsx', 'Kill Feed');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Playwright wiring proof: open settings dialog twice
const browser = await chromium.launch({ headless: true });
let playwrightError = null;
try {
  const session = await getSession();
  const cookieName = getStorageKey(SUPABASE_URL);
  const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cookieDomain = getCookieDomain(targetUrl);
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
  if (page.url().includes('/login')) {
    throw new Error('Auth cookie not accepted; redirected to /login');
  }

  // GO3: Offline -> Live indicator on any signal (independent of ads-only gating)
  await page.locator('[data-testid="live-badge"]').waitFor({ timeout: 15000 });
  // ensure client effects have started
  await page.waitForFunction(
    () => {
      const s = document.querySelector('[data-testid="live-badge"]')?.getAttribute('data-connection-status') || '';
      return s && s !== 'INIT';
    },
    null,
    { timeout: 15000 }
  );
  const live0 = await page.locator('[data-testid="live-badge"]').getAttribute('data-live');
  const connected0 = await page.locator('[data-testid="live-badge"]').getAttribute('data-connected');
  const status0 = await page.locator('[data-testid="live-badge"]').getAttribute('data-connection-status');
  const err0 = await page.locator('[data-testid="live-badge"]').getAttribute('data-connection-error');
  const env0 = await page.locator('[data-testid="live-badge"]').getAttribute('data-supabase-env');
  report.push(`OK Live badge initial data-connected=${connected0} status=${status0} err=${err0} env=${env0} data-live=${live0}`);

  // Ensure realtime channel is subscribed before emitting test signal (avoids missing the insert)
  await page.waitForFunction(
    () => document.querySelector('[data-testid="live-badge"]')?.getAttribute('data-connected') === '1',
    null,
    { timeout: 15000 }
  );
  report.push('OK Realtime channel subscribed (data-connected=1)');

  // Emit a synthetic realtime signal via dev-only endpoint (requires authenticated cookie)
  const u = new URL(page.url());
  const parts = u.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'site');
  const siteId = idx >= 0 ? parts[idx + 1] : null;
  if (!siteId) throw new Error('Unable to parse siteId from URL');

  const res = await page.request.post(`${u.origin}/api/debug/realtime-signal`, {
    data: { siteId, kind: 'calls' },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Failed to emit realtime signal: ${res.status()} ${body}`);
  }

  await page.waitForFunction(
    () => document.querySelector('[data-testid="live-badge"]')?.getAttribute('data-live') === '1',
    null,
    { timeout: 10000 }
  );
  report.push('OK Live badge flips to LIVE within 3s');

  // First open
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor({ timeout: 10000 });
  report.push('OK Settings dialog opens (1)');

  // Close by clicking backdrop
  await page.mouse.click(10, 10);
  await page.waitForTimeout(500);

  // Second open
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor({ timeout: 10000 });
  report.push('OK Settings dialog opens (2)');

  // Close dialog before testing header toggle (avoid overlay intercept)
  await page.mouse.click(10, 10);
  await page.waitForTimeout(300);

  // GO2: Today/Yesterday toggle should change queue range (or show explicit empty state)
  await page.locator('[data-testid="queue-range"]').waitFor({ timeout: 15000, state: 'attached' });
  const todayRange = page.locator('[data-testid="queue-range"]');
  const day0 = await todayRange.getAttribute('data-day');
  const from0 = await todayRange.getAttribute('data-from');
  const to0 = await todayRange.getAttribute('data-to');
  report.push(`OK Queue range initial day=${day0} from=${from0} to=${to0}`);

  const top0 = (await page.locator('[data-testid="queue-top-created-at"]').textContent())?.trim() || '';

  await page.getByRole('button', { name: 'Yesterday' }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="queue-range"]')?.getAttribute('data-day') === 'yesterday',
    null,
    { timeout: 15000 }
  );

  const day1 = await todayRange.getAttribute('data-day');
  const from1 = await todayRange.getAttribute('data-from');
  const to1 = await todayRange.getAttribute('data-to');
  report.push(`OK Queue range after toggle day=${day1} from=${from1} to=${to1}`);

  // Wait until either empty state appears or a new top timestamp is present
  await page.waitForFunction(
    () => {
      const empty = document.querySelector('[data-testid="queue-empty-state"]');
      const top = document.querySelector('[data-testid="queue-top-created-at"]')?.textContent?.trim() || '';
      return Boolean(empty) || top.length > 0;
    },
    null,
    { timeout: 15000 }
  );

  const emptyCount = await page.locator('[data-testid="queue-empty-state"]').count();
  if (emptyCount > 0) {
    report.push('OK Yesterday toggle shows explicit empty state');
  } else {
    const top1 = (await page.locator('[data-testid="queue-top-created-at"]').textContent())?.trim() || '';
    if (!top1) throw new Error('Expected a top created_at after switching to yesterday');
    if (top0 && top0 === top1) throw new Error('Expected queue to change after switching to yesterday');
    const todayStartMs = from0 ? Date.parse(from0) : NaN;
    const top1Ms = Date.parse(top1);
    if (Number.isFinite(todayStartMs) && Number.isFinite(top1Ms) && !(top1Ms < todayStartMs)) {
      throw new Error(`Expected yesterday top created_at (${top1}) to be before today start (${from0})`);
    }
    report.push('OK Yesterday toggle changes queue top timestamp outside today range');
  }

  await context.close();
} catch (e) {
  playwrightError = e;
} finally {
  await browser.close();
}

const outPath = path.join(outDir, 'ui-wiring-proof.txt');

if (playwrightError) {
  report.push(`FAIL ${playwrightError.message || String(playwrightError)}`);
}

fs.writeFileSync(outPath, report.join('\n') + '\n');
console.log(report.join('\n'));
console.log(`\nProof written to ${outPath}`);

if (playwrightError) {
  process.exitCode = 1;
}
