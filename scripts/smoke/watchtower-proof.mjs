/**
 * GO W1 + W2 — Watchtower foundation + error-tracking smoke.
 * 1) GET /api/health → assert ok=true, x-request-id header present.
 * 2) If WATCHTOWER_TEST_THROW=1: GET /api/watchtower/test-throw → assert 500 + x-request-id
 *    (verifies integration hooks fire; we cannot verify Sentry delivery offline).
 *
 * Requires: app running (npm run dev).
 * Usage: node scripts/smoke/watchtower-proof.mjs
 *        WATCHTOWER_TEST_THROW=1 node scripts/smoke/watchtower-proof.mjs  (adds test-throw check)
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const BASE_URL = process.env.PROOF_URL || 'http://localhost:3000';
const OUT_DIR_GO1 = path.join(process.cwd(), 'docs', '_archive', '2026-02-02', 'WAR_ROOM', 'EVIDENCE', 'WATCHTOWER_GO1');
const OUT_DIR_GO2 = path.join(process.cwd(), 'docs', '_archive', '2026-02-02', 'WAR_ROOM', 'EVIDENCE', 'WATCHTOWER_GO2');

fs.mkdirSync(OUT_DIR_GO1, { recursive: true });
fs.mkdirSync(OUT_DIR_GO2, { recursive: true });

const healthUrl = `${BASE_URL}/api/health`;

// 1) GET /api/health
let res;
try {
  res = await fetch(healthUrl, { method: 'GET' });
} catch (err) {
  const cause = err?.cause?.code ?? err?.code ?? '';
  if (cause === 'ECONNREFUSED' || (err?.message && err.message.includes('fetch failed'))) {
    console.error('App not running. Start with: npm run dev');
    console.error('Then run: node scripts/smoke/watchtower-proof.mjs');
    fs.writeFileSync(path.join(OUT_DIR_GO1, 'smoke_log.txt'), 'ECONNREFUSED: app not running. Run npm run dev first.\n');
  } else {
    console.error('Fetch error:', err);
    fs.writeFileSync(path.join(OUT_DIR_GO1, 'smoke_log.txt'), `Fetch error: ${err?.message ?? err}\n`);
  }
  process.exit(1);
}

const body = await res.json().catch(() => ({}));
const requestId = res.headers.get('x-request-id');

if (res.status !== 200) {
  console.error('Health failed:', res.status, body);
  fs.writeFileSync(path.join(OUT_DIR_GO1, 'smoke_log.txt'), `Health failed: ${res.status} ${JSON.stringify(body)}\n`);
  process.exit(1);
}

if (!body.ok) {
  console.error('Health body.ok not true:', body);
  fs.writeFileSync(path.join(OUT_DIR_GO1, 'smoke_log.txt'), `Health ok=false: ${JSON.stringify(body)}\n`);
  process.exit(1);
}

if (!requestId) {
  console.error('Missing x-request-id header');
  fs.writeFileSync(path.join(OUT_DIR_GO1, 'smoke_log.txt'), 'Missing x-request-id header\n');
  process.exit(1);
}

console.log('Health ok:', body.ok, 'ts:', body.ts, 'x-request-id:', requestId);
if (body.git_sha) console.log('git_sha:', body.git_sha);
if (body.db_ok !== undefined) console.log('db_ok:', body.db_ok);

const log = `health_ok=true\nx-request-id=${requestId}\nts=${body.ts}\n`;
fs.writeFileSync(path.join(OUT_DIR_GO1, 'smoke_log.txt'), log);
console.log('GO W1 Watchtower smoke: PASS. Log:', path.join(OUT_DIR_GO1, 'smoke_log.txt'));

// GO W2: test-throw (only when WATCHTOWER_TEST_THROW=1)
if (process.env.WATCHTOWER_TEST_THROW === '1') {
  const testThrowUrl = `${BASE_URL}/api/watchtower/test-throw`;
  let resThrow;
  try {
    resThrow = await fetch(testThrowUrl, { method: 'GET' });
  } catch (err) {
    console.error('Test-throw fetch error:', err);
    fs.writeFileSync(path.join(OUT_DIR_GO2, 'smoke_log.txt'), `Test-throw fetch error: ${err?.message ?? err}\n`);
    process.exit(1);
  }
  const throwRequestId = resThrow.headers.get('x-request-id');
  if (resThrow.status !== 500) {
    console.error('Test-throw expected 500, got:', resThrow.status);
    fs.writeFileSync(path.join(OUT_DIR_GO2, 'smoke_log.txt'), `Test-throw expected 500, got ${resThrow.status}\n`);
    process.exit(1);
  }
  if (!throwRequestId) {
    console.error('Test-throw missing x-request-id header');
    fs.writeFileSync(path.join(OUT_DIR_GO2, 'smoke_log.txt'), 'Test-throw missing x-request-id\n');
    process.exit(1);
  }
  console.log('GO W2 test-throw: 500 with x-request-id (captured error). request_id:', throwRequestId);
  fs.writeFileSync(
    path.join(OUT_DIR_GO2, 'smoke_log.txt'),
    `test_throw_500=true\nx-request-id=${throwRequestId}\ncaptured error (integration hooks fire)\n`
  );
  console.log('GO W2 Watchtower error-tracking smoke: PASS. Log:', path.join(OUT_DIR_GO2, 'smoke_log.txt'));
}
