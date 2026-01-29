/**
 * Smoke: Hunter AI UI proof — HOT LEAD badge and AI Özet visible when RPC returns ai_score/ai_summary.
 * Mocks get_recent_intents_v2 to return one intent with ai_score=85, ai_summary, ai_tags so we can
 * assert the dashboard shows HOT LEAD and AI Özet without depending on real Hunter AI–processed data.
 *
 * Usage:
 *   npm run smoke:hunter-ai-ui
 *   SMOKE_DEBUG=1 npm run smoke:hunter-ai-ui   → Detektif modu: tarayıcı açık, konsol hataları + hata ekran görüntüsü (debug-error.png)
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const report = [];
const targetUrl =
  process.env.PROOF_URL ||
  'http://localhost:3000/dashboard/site/00000000-0000-0000-0000-000000000001';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROOF_EMAIL = process.env.PROOF_EMAIL || 'playwright-proof@opsmantik.local';
const PROOF_PASSWORD = process.env.PROOF_PASSWORD || 'ProofPass!12345';

const MOCK_AI_SUMMARY = 'Smoke test AI özet. Yüksek niyetli lead.';

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
    throw new Error(`Failed to authenticate Playwright user: ${error?.message || 'unknown'}`);
  }
  const userId = data.session.user.id;
  await admin.from('profiles').upsert({ id: userId, role: 'admin' });
  return data.session;
}

/** Returns created_at inside [fromIso, toIso] so UI date filter keeps the row. Dynamic date, not stale. */
function createdAtInRange(fromIso, toIso) {
  const fromMs = fromIso ? new Date(fromIso).getTime() : NaN;
  const toMs = toIso ? new Date(toIso).getTime() : NaN;
  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs >= fromMs) {
    const midMs = fromMs + Math.floor((toMs - fromMs) / 2);
    return new Date(midMs).toISOString();
  }
  return new Date(Date.now() - 60 * 1000).toISOString();
}

/** One intent row with Hunter AI fields so HOT LEAD + AI Özet render. created_at is dynamic and inside client range. */
function mockIntentRow(params = {}) {
  const created_at = createdAtInRange(params.p_date_from, params.p_date_to);
  return {
    id: 'smoke-hunter-ai-' + Date.now(),
    created_at,
    intent_action: 'whatsapp',
    intent_target: '+905551234567',
    intent_page_url: 'https://example.com/antika',
    matched_session_id: null,
    lead_score: null,
    status: 'intent',
    click_id: null,
    risk_level: 'low',
    risk_reasons: null,
    oci_stage: 'pending',
    oci_status: null,
    attribution_source: null,
    gclid: null,
    wbraid: null,
    gbraid: null,
    total_duration_sec: 120,
    event_count: 5,
    ai_score: 85,
    ai_summary: MOCK_AI_SUMMARY,
    ai_tags: ['high-intent', 'whatsapp'],
  };
}

const DEBUG = process.env.SMOKE_DEBUG === '1';
const browser = await chromium.launch({
  headless: !DEBUG,
  slowMo: DEBUG ? 100 : 0,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
let playwrightError = null;

if (DEBUG) {
  console.log('🔍 Detektif modu: tarayıcı görünür, hatalar terminale basılacak.');
}

try {
  const session = await getSession();
  const cookieName = getStorageKey(SUPABASE_URL);
  const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;
  const context = await browser.newContext({
    viewport: DEBUG ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  });
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

  if (DEBUG) {
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        console.log(`[BROWSER ${type.toUpperCase()}]:`, msg.text());
      }
    });
    page.on('pageerror', (err) => {
      console.log('[BROWSER CRASH]:', err.message || String(err));
    });
  }

  const rpcRequestUrls = [];
  let rpcMocked = false;
  // Only intercept get_recent_intents RPC (do NOT intercept **/* — it can break page load).
  const mockRpc = async (route) => {
    rpcMocked = true;
    const req = route.request();
    const url = typeof req.url === 'function' ? req.url() : (req.url ?? '');
    rpcRequestUrls.push(String(url));
    let params = {};
    try {
      const postData = req.postData();
      if (postData) params = JSON.parse(postData);
    } catch (_) {}
    const from = params.p_date_from ?? params.p_since;
    const to = params.p_date_to ?? (params.p_since && params.p_minutes_lookback
      ? new Date(new Date(params.p_since).getTime() + params.p_minutes_lookback * 60 * 1000).toISOString()
      : null);
    const body = JSON.stringify([mockIntentRow({ p_date_from: from, p_date_to: to })]);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body,
    });
  };
  await page.route('**/rest/v1/rpc/get_recent_intents_v1', mockRpc);
  await page.route('**/rest/v1/rpc/get_recent_intents_v2', mockRpc);

  let effectiveUrl = targetUrl;
  const u0 = new URL(targetUrl);
  if (u0.hostname === 'localhost' || u0.hostname === '127.0.0.1') {
    const resp = await page.request.post(`${u0.origin}/api/create-test-site`);
    if (resp.ok()) {
      const j = await resp.json();
      const sid = j?.site?.id;
      if (sid) {
        effectiveUrl = `${u0.origin}/dashboard/site/${sid}?tab=live`;
      }
    }
  }

  await page.goto(effectiveUrl, { waitUntil: 'networkidle', timeout: 60000 });
  const currentUrl = page.url();
  if (DEBUG) console.log('📍 Current URL:', currentUrl);
  if (currentUrl.includes('/login')) {
    throw new Error('REDIRECTED TO LOGIN! Test user is not authenticated. Cookie may be invalid or domain mismatch.');
  }

  await page.locator('[data-testid="live-badge"]').waitFor({ timeout: 15000 });
  await page.locator('[data-testid="queue-range"]').waitFor({ timeout: 15000, state: 'attached' });

  // Give the queue time to fire its RPC (useEffect) and for our mock to apply.
  await page.waitForTimeout(4000);

  // Wait for loading to finish: either empty state, card (HOT LEAD), or error message.
  await page.waitForFunction(
    () => {
      const empty = document.querySelector('[data-testid="queue-empty-state"]');
      const hotLead = document.querySelector('[data-testid="hunter-card-hot-lead"]');
      const err = document.body?.innerText?.includes('Failed to load intents');
      return Boolean(empty) || Boolean(hotLead) || Boolean(err);
    },
    null,
    { timeout: 35000 }
  );

  const errorEl = page.locator('text=Failed to load intents').first();
  if (await errorEl.isVisible().catch(() => false)) {
    const errText = await page.locator('.text-rose-800').first().textContent().catch(() => '');
    throw new Error(`Queue showed error: ${errText || 'Failed to load intents'}`);
  }

  const emptyVisible = await page.locator('[data-testid="queue-empty-state"]').isVisible().catch(() => false);
  if (emptyVisible) {
    const rpcSeen = rpcRequestUrls.length;
    const hint =
      rpcSeen === 0
        ? 'No Supabase RPC request was seen from the page (queue may use server data or different API).'
        : rpcMocked
          ? `RPC was mocked (${rpcSeen} request(s)) but queue still empty — check response format or date filter.`
          : `RPC request(s) seen but URL did not match get_recent_intents. URLs: ${rpcRequestUrls.slice(0, 3).join(' | ')}`;
    throw new Error(`Queue shows empty state. ${hint}`);
  }

  // Queue should show one card (our mock). Wait for HOT LEAD badge.
  await page.locator('[data-testid="hunter-card-hot-lead"]').waitFor({ timeout: 15000, state: 'visible' });
  const hotLeadText = await page.locator('[data-testid="hunter-card-hot-lead"]').textContent().catch(() => '');
  if (!hotLeadText.includes('HOT LEAD')) {
    throw new Error(`HOT LEAD badge wrong text: ${hotLeadText}`);
  }
  report.push('OK HOT LEAD badge visible and contains "HOT LEAD"');

  await page.locator('[data-testid="hunter-card-ai-summary"]').waitFor({ timeout: 10000, state: 'visible' });
  const aiSummaryText = await page.locator('[data-testid="hunter-card-ai-summary"]').textContent().catch(() => '');
  if (!aiSummaryText.includes('AI Özet') || !aiSummaryText.includes(MOCK_AI_SUMMARY)) {
    throw new Error(`AI Özet section missing expected text: ${aiSummaryText.slice(0, 200)}`);
  }
  report.push('OK AI Özet section visible with mock summary text');

  await context.close();
} catch (e) {
  playwrightError = e;
  report.push(`FAIL ${e.message || String(e)}`);
  try {
    const contexts = await browser.contexts();
    const p = contexts[0]?.pages?.()?.[0];
    if (p) {
      await p.screenshot({ path: 'debug-error.png', fullPage: true });
      console.log('📸 Screenshot saved to debug-error.png');
    }
  } catch (_) {}
  if (DEBUG) {
    console.log('⏳ 5 saniye sonra tarayıcı kapanacak...');
    await new Promise((r) => setTimeout(r, 5000));
  }
} finally {
  await browser.close();
}

console.log(report.join('\n'));
if (playwrightError) {
  process.exitCode = 1;
} else {
  console.log('\n✅ Hunter AI UI smoke: HOT LEAD + AI Özet kanıtlandı.');
}
