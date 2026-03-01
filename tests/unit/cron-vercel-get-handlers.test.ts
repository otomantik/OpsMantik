/**
 * PR-1: Vercel Cron GET compatibility tests.
 * Asserts each of the 4 cron routes exports both GET and POST handlers.
 * Source-based inspection (robust, no brittle line numbers).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES = [
  { path: join(process.cwd(), 'app', 'api', 'cron', 'dispatch-conversions', 'route.ts'), name: 'dispatch-conversions' },
  { path: join(process.cwd(), 'app', 'api', 'cron', 'auto-junk', 'route.ts'), name: 'auto-junk' },
  { path: join(process.cwd(), 'app', 'api', 'cron', 'idempotency-cleanup', 'route.ts'), name: 'idempotency-cleanup' },
  { path: join(process.cwd(), 'app', 'api', 'cron', 'invoice-freeze', 'route.ts'), name: 'invoice-freeze' },
] as const;

for (const route of ROUTES) {
  test(`PR-1: ${route.name} exports GET handler`, () => {
    const src = readFileSync(route.path, 'utf-8');
    assert.ok(
      /export\s+async\s+function\s+GET\s*\(/.test(src),
      `${route.name} must export async function GET(req) for Vercel Cron compatibility`
    );
  });

  test(`PR-1: ${route.name} exports POST handler`, () => {
    const src = readFileSync(route.path, 'utf-8');
    assert.ok(
      /export\s+async\s+function\s+POST\s*\(/.test(src),
      `${route.name} must export async function POST(req) for manual/Bearer calls`
    );
  });

  test(`PR-1: ${route.name} uses requireCronAuth before run`, () => {
    const src = readFileSync(route.path, 'utf-8');
    assert.ok(src.includes('requireCronAuth'), `${route.name} must use requireCronAuth (fail-closed)`);
    assert.ok(
      src.includes('if (forbidden) return forbidden'),
      `${route.name} must call requireCronAuth first and return early if forbidden`
    );
  });
}

// PR-2: dispatch-conversions uses distributed cron lock
test('PR-2: dispatch-conversions uses tryAcquireCronLock("dispatch-conversions")', () => {
  const path = join(process.cwd(), 'app', 'api', 'cron', 'dispatch-conversions', 'route.ts');
  const src = readFileSync(path, 'utf-8');
  assert.ok(
    src.includes('tryAcquireCronLock(\'dispatch-conversions\''),
    'dispatch-conversions must use tryAcquireCronLock("dispatch-conversions") for overlap prevention'
  );
  assert.ok(src.includes('releaseCronLock'), 'dispatch-conversions must release lock in finally');
  assert.ok(src.includes('skipped: true') && src.includes('reason: \'lock_held\''), 'must return { ok: true, skipped: true, reason: "lock_held" } when lock held');
});

// PR-3: POST handlers also acquire cron locks (process-offline-conversions, providers/recover-processing)
const PR3_ROUTES = [
  { path: join(process.cwd(), 'app', 'api', 'cron', 'process-offline-conversions', 'route.ts'), name: 'process-offline-conversions' },
  { path: join(process.cwd(), 'app', 'api', 'cron', 'providers', 'recover-processing', 'route.ts'), name: 'providers/recover-processing' },
] as const;

for (const route of PR3_ROUTES) {
  test(`PR-3: ${route.name} POST path is not lock-free (uses tryAcquireCronLock)`, () => {
    const src = readFileSync(route.path, 'utf-8');
    assert.ok(src.includes('tryAcquireCronLock'), `${route.name} must use tryAcquireCronLock for both GET and POST`);
  });

  test(`PR-3: ${route.name} POST calls handlerWithLock`, () => {
    const src = readFileSync(route.path, 'utf-8');
    assert.ok(
      src.includes('handlerWithLock'),
      `${route.name} must define handlerWithLock for shared lock logic`
    );
    assert.ok(
      /return\s+handlerWithLock\s*\(req\)/.test(src),
      `${route.name} POST must return handlerWithLock(req)`
    );
  });
}
