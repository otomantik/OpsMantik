/**
 * CUT-02A / CUT-02B: Vercel cron schedule contract — schedule surface only (handlers may remain).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const vercelPath = join(ROOT, 'vercel.json');

/** Post CUT-02B: 7 schedules (core + monthly); cleanup merged into night-maintenance. */
const EXPECTED_SCHEDULED = [
  '/api/cron/oci/process-outbox-events',
  '/api/cron/oci-maintenance',
  '/api/cron/night-maintenance',
  '/api/cron/auto-junk',
  '/api/cron/watchtower',
  '/api/cron/reconcile-usage',
  '/api/cron/invoice-freeze',
] as const;

const REMOVED_IN_CUT_02B = ['/api/cron/cleanup'] as const;

const REMOVED_IN_CUT_02A = [
  '/api/cron/funnel-projection',
  '/api/cron/truth-parity-repair',
  '/api/cron/idempotency-cleanup',
  '/api/cron/oci/outbox-cleanup',
  '/api/cron/processed-signals-retention',
  '/api/cron/gdpr-retention',
  '/api/cron/oci-recovery',
  '/api/cron/vacuum',
  '/api/cron/oci/ack-receipt-ttl',
  '/api/cron/oci/enqueue-from-sales',
] as const;

type VercelCronConfig = {
  crons: { path: string; schedule: string }[];
};

function loadVercelCrons(): VercelCronConfig {
  return JSON.parse(readFileSync(vercelPath, 'utf8')) as VercelCronConfig;
}

test('CUT-02B: vercel.json contains exactly 7 cron schedules', () => {
  const { crons } = loadVercelCrons();
  assert.equal(crons.length, 7, `expected 7 schedules, got ${crons.length}`);
});

test('CUT-02B: approved core schedules are present', () => {
  const paths = loadVercelCrons().crons.map((c) => c.path);
  for (const expected of EXPECTED_SCHEDULED) {
    assert.ok(paths.includes(expected), `missing scheduled path: ${expected}`);
  }
});

test('CUT-02A/02B: removed schedules are absent from vercel.json', () => {
  const paths = loadVercelCrons().crons.map((c) => c.path);
  for (const removed of REMOVED_IN_CUT_02A) {
    assert.ok(!paths.includes(removed), `must not schedule removed path: ${removed}`);
  }
  for (const removed of REMOVED_IN_CUT_02B) {
    assert.ok(!paths.includes(removed), `must not schedule removed path: ${removed}`);
  }
});

test('CUT-02A: no duplicate schedule paths', () => {
  const paths = loadVercelCrons().crons.map((c) => c.path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate cron path in vercel.json');
});

test('CUT-02A: invoice-freeze remains monthly', () => {
  const row = loadVercelCrons().crons.find((c) => c.path === '/api/cron/invoice-freeze');
  assert.ok(row, 'invoice-freeze must remain scheduled');
  assert.equal(row.schedule, '0 0 1 * *', 'invoice-freeze must stay monthly (1st of month)');
});

test('CUT-02B: cleanup unscheduled; night-maintenance remains', () => {
  const paths = loadVercelCrons().crons.map((c) => c.path);
  assert.ok(!paths.includes('/api/cron/cleanup'));
  assert.ok(!paths.some((p) => p.endsWith('signals-cleanup')), 'legacy audit cleanup cron must stay off schedule');
  assert.ok(paths.includes('/api/cron/night-maintenance'));
});
