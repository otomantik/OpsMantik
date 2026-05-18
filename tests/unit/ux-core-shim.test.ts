import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const shimPath = join(process.cwd(), 'public/ux-core.js');

test('public/ux-core.js back-compat shim loads canonical /assets/core.js only', () => {
  const shim = readFileSync(shimPath, 'utf-8');
  assert.ok(shim.includes('/assets/core.js'));
  assert.ok(!/\/api\/call-event(?!\/v2)/.test(shim));
  assert.ok(!shim.includes('opsmantik_outbox'));
  assert.ok(shim.length < 1024);
});
