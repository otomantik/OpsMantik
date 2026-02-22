#!/usr/bin/env node
/**
 * Smoke test for N+1 bulk refactored cron endpoints.
 * Requires: dev server running, .env.local with CRON_SECRET.
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const BASE = process.env.SMOKE_BASE_URL ?? process.env.PROOF_URL ?? 'http://localhost:3000';
const SECRET = process.env.CRON_SECRET;

if (!SECRET) {
  console.error('CRON_SECRET not set in .env.local');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SECRET}`,
  'Content-Type': 'application/json',
};

async function test(name, method, path, body) {
  try {
    const url = `${BASE}${path}`;
    const opts = { method, headers };
    if (body && method === 'POST') opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    const ok = res.ok ? 'OK' : 'FAIL';
    console.log(`[${ok}] ${name}: ${res.status}`, json);
    return res.ok;
  } catch (err) {
    console.error(`[ERR] ${name}:`, err.message);
    return false;
  }
}

async function main() {
  console.log('--- Cron bulk endpoints smoke test ---');
  console.log('BASE:', BASE);

  const r1 = await test('process-offline-conversions (OCI)', 'POST', '/api/cron/process-offline-conversions?limit=5');
  const r2 = await test('invoice-freeze', 'POST', '/api/cron/invoice-freeze');
  const r3 = await test('recover (fallback buffer)', 'GET', '/api/cron/recover');

  const pass = [r1, r2, r3].filter(Boolean).length;
  console.log('---');
  console.log(`Result: ${pass}/3 passed`);
  process.exit(pass === 3 ? 0 : 1);
}

main();
