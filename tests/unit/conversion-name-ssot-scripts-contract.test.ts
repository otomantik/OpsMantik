import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/domain/mizan-mantik/conversion-names';

const REQUIRED = new Set(Object.values(OPSMANTIK_CONVERSION_NAMES));

test('Google Ads script README lists SSOT conversion action names', () => {
  const readme = readFileSync(join(process.cwd(), 'scripts', 'google-ads-oci', 'README.md'), 'utf8');
  for (const name of REQUIRED) {
    assert.ok(readme.includes(name), `README must mention SSOT action name: ${name}`);
  }
});
