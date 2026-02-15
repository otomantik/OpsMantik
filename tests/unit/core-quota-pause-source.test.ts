/**
 * Source-level guard: core.js must explicitly handle quota-exceeded 429 to stop retry storms.
 * We use source inspection because core.js runs in browsers and is not imported in unit runtime.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('core.js: quota-exceeded 429 pause logic exists (x-opsmantik-quota-exceeded + retry-after)', () => {
  const p = join(process.cwd(), 'public', 'assets', 'core.js');
  const src = readFileSync(p, 'utf8');
  assert.ok(src.includes('quotaPausedUntil'), 'core.js must maintain a quotaPausedUntil state');
  assert.ok(src.includes('x-opsmantik-quota-exceeded'), 'core.js must detect quota-exceeded header');
  assert.ok(src.toLowerCase().includes('retry-after'), 'core.js must read Retry-After header for pause duration');
});

