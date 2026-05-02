/**
 * Guards: legacy parallel economics paths must not creep back into the router SSOT insert.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('insert-marketing-signal does not import marketing-signal-hash cents helpers', () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'insert-marketing-signal.ts'),
    'utf8'
  );
  assert.ok(!src.includes('toExpectedValueCents'), 'use loadMarketingSignalEconomics only');
  assert.ok(!src.includes('marketing-signal-hash'), 'no parallel hash/economics import');
});

test('upsert-marketing-signal requires economics parameter', () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'upsert-marketing-signal.ts'),
    'utf8'
  );
  assert.match(src, /economics:\s*MarketingSignalEconomics/);
});
