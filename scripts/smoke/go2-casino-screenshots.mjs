/**
 * GO2 Casino UI — Playwright screenshots: Hunter card + Seal modal (chips).
 * Saves: hunter-card.png, seal-modal-chips.png under docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/
 *
 * Requires: app running (npm run start/dev), .env.local with Supabase + PROOF_*.
 * Usage: node scripts/smoke/go2-casino-screenshots.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const OUT_DIR = path.join(process.cwd(), 'docs', 'WAR_ROOM', 'EVIDENCE', 'GO2_CASINO_UI');
const BASE_URL = process.env.PROOF_URL || 'http://localhost:3000';
const DASHBOARD_PATH = process.env.PROOF_DASHBOARD_PATH || '/dashboard/site/01d24667-ca9a-44e3-ab7a-7cd171ae653f';
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
// App's createServerClient() does not pass cookieOptions → auth-js default: 'supabase.auth.token'
const cookieName = 'supabase.auth.token';
const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;
const cookieDomain = getCookieDomain(BASE_URL);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  baseURL: BASE_URL,
});
await context.addCookies([{
  name: cookieName,
  value: cookieValue,
  domain: cookieDomain,
  path: '/',
  httpOnly: false,
  secure: cookieDomain !== 'localhost' && cookieDomain !== '127.0.0.1',
  sameSite: 'Lax',
}]);

const page = await context.newPage();
await page.goto(BASE_URL + DASHBOARD_PATH, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2000);

// Hunter card: first card in queue (data-testid="hunter-card-seal-deal" is on the button)
const hunterCard = page.locator('[data-testid="hunter-card-seal-deal"]').first();
const cardVisible = await hunterCard.isVisible().catch(() => false);
if (cardVisible) {
  const card = page.locator('main').locator('article, [class*="card"]').first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, 'hunter-card.png'), fullPage: false });
  console.log('Saved:', path.join(OUT_DIR, 'hunter-card.png'));

  // Open Seal modal (SEAL DEAL)
  await hunterCard.click();
  await page.waitForTimeout(600);
  const modal = page.locator('[data-testid="seal-modal"]');
  const modalVisible = await modal.isVisible().catch(() => false);
  if (modalVisible) {
    await page.screenshot({ path: path.join(OUT_DIR, 'seal-modal-chips.png'), fullPage: false });
    console.log('Saved:', path.join(OUT_DIR, 'seal-modal-chips.png'));
    await page.keyboard.press('Escape');
  } else {
    console.log('Seal modal not visible (no card or already sealed)');
  }
} else {
  console.log('No Hunter card visible (empty queue); hunter-card.png not taken.');
}

await context.close();
await browser.close();
console.log('GO2 Casino screenshots done. Output:', OUT_DIR);
