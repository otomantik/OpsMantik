#!/usr/bin/env node

/**
 * Quick dependency audit for sync -> worker delivery chain.
 * This does not hit network; it validates required runtime env contract.
 */

import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
];

const missing = required.filter((key) => {
  const value = process.env[key];
  return value == null || String(value).trim() === '';
});

const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim();
const vercelUrl = (process.env.VERCEL_URL ?? '').trim();
const resolvedBase = appUrl || (vercelUrl ? `https://${vercelUrl.replace(/^https?:\/\//, '')}` : '');

const problems = [];
if (!/^https?:\/\//i.test(resolvedBase)) {
  problems.push('NEXT_PUBLIC_APP_URL (or VERCEL_URL fallback) does not resolve to an absolute URL');
}

const insecureWorker = (process.env.ALLOW_INSECURE_DEV_WORKER ?? '').toLowerCase() === 'true';
const directWorker = (process.env.OPSMANTIK_SYNC_DIRECT_WORKER ?? '') === '1';

if (missing.length > 0) {
  console.error('[intent-worker-deps] Missing env keys:');
  missing.forEach((k) => console.error(` - ${k}`));
}

if (problems.length > 0) {
  console.error('[intent-worker-deps] Contract issues:');
  problems.forEach((p) => console.error(` - ${p}`));
}

console.log('[intent-worker-deps] resolved_worker_base_url:', resolvedBase || '(empty)');
console.log('[intent-worker-deps] direct_worker_mode:', directWorker ? 'enabled' : 'disabled');
console.log('[intent-worker-deps] insecure_dev_worker:', insecureWorker ? 'enabled' : 'disabled');

if (missing.length > 0 || problems.length > 0) {
  process.exit(1);
}

console.log('[intent-worker-deps] OK');
