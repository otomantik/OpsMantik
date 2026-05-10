import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('pr9h6-intent-signal-readiness-audit.mjs: read-only audit contract', () => {
  const p = join(process.cwd(), 'scripts', 'db', 'pr9h6-intent-signal-readiness-audit.mjs');
  const src = readFileSync(p, 'utf8');
  assert.match(src, /resolveSiteIdentity/);
  assert.match(src, /offline_conversion_queue/);
  assert.match(src, /Never mutates/i);
  assert.doesNotMatch(src, /console\.log\([^)]*gclid/i);
});
