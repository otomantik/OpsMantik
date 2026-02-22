#!/usr/bin/env node
/**
 * Smoke test: curl.exe ile cron endpoint'leri test eder.
 * Kullanım: node scripts/smoke/cron-bulk-curl.mjs
 * Gereksinim: Sunucu çalışıyor olmalı (npm run dev veya prod).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { execSync } from 'child_process';

config({ path: resolve(process.cwd(), '.env.local') });

// SMOKE_BASE_URL=prod, PROOF_URL=local. Örn: SMOKE_BASE_URL=https://console.opsmantik.com
const BASE = process.env.SMOKE_BASE_URL ?? process.env.PROOF_URL ?? 'http://localhost:3000';
const SECRET = process.env.CRON_SECRET;

if (!SECRET) {
  console.error('HATA: .env.local içinde CRON_SECRET tanımlı değil');
  process.exit(1);
}

function curl(name, method, path) {
  const url = `${BASE}${path}`;
  const safeSecret = SECRET.replace(/"/g, '\\"');
  const cmd = `curl.exe -s -w "\\n%{http_code}" -X ${method} -H "Authorization: Bearer ${safeSecret}" "${url}"`;
  let out = '';
  try {
    out = execSync(cmd, { encoding: 'utf8', timeout: 25000 }).trim();
  } catch (e) {
    console.log(`[ERR] ${name}:`, e.message || String(e));
    return false;
  }
  const parts = out.split('\n');
  const code = parts.pop() ?? '000';
  const body = parts.join('\n');
  let json;
  try {
    json = body ? JSON.parse(body) : {};
  } catch {
    json = { raw: body.slice(0, 150) };
  }
  const ok = code.startsWith('2') ? 'OK' : 'FAIL';
  console.log(`[${ok}] ${name}: HTTP ${code}`);
  if (Object.keys(json).length > 0 && json.raw === undefined) {
    console.log('     ', JSON.stringify(json).slice(0, 120) + (JSON.stringify(json).length > 120 ? '...' : ''));
  }
  return code.startsWith('2');
}

console.log('--- Cron bulk endpoints (curl.exe) ---');
console.log('BASE:', BASE);

const t1 = curl('process-offline-conversions (OCI)', 'POST', '/api/cron/process-offline-conversions?limit=5');
const t2 = curl('invoice-freeze', 'POST', '/api/cron/invoice-freeze');
const t3 = curl('recover (fallback buffer)', 'GET', '/api/cron/recover');

const pass = [t1, t2, t3].filter(Boolean).length;
console.log('---');
console.log(`Sonuç: ${pass}/3 geçti`);
process.exit(pass === 3 ? 0 : 1);
