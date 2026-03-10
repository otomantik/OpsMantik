import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIDDLEWARE = join(ROOT, 'middleware.ts');

test('/api/sync bypasses auth/session middleware to keep ingest fast', () => {
  const src = readFileSync(MIDDLEWARE, 'utf8');
  assert.ok(src.includes("if (path === '/api/sync')"), 'middleware must special-case /api/sync');
  assert.ok(src.includes('return nextWithTraceHeaders(request, traceId);'), 'sync path must fast-return with trace headers');
  assert.ok(src.includes('server-side rate limit'), 'sync fast path must document route-level protection');
});
