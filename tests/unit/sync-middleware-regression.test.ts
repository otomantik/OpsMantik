import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIDDLEWARE = join(ROOT, 'middleware.ts');

test('/api routes bypass auth/session middleware to keep system endpoints fast', () => {
  const src = readFileSync(MIDDLEWARE, 'utf8');
  assert.ok(src.includes("if (path.startsWith('/api/'))"), 'middleware must fast-path all API routes');
  assert.ok(src.includes('return nextWithTraceHeaders(request, traceId);'), 'sync path must fast-return with trace headers');
  assert.ok(src.includes('can stall health checks, ingest, and cron/webhook traffic'), 'API fast path must document why auth refresh is skipped');
});
