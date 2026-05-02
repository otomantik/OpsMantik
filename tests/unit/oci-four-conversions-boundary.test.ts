/**
 * Guard: upper-funnel conversion names never enter offline_conversion_queue;
 * seal path only enqueues OpsMantik_Won.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('enqueueSealConversion inserts offline queue with OpsMantik_Won only', () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts'),
    'utf8'
  );
  assert.match(
    src,
    /action:\s*OPSMANTIK_CONVERSION_NAMES\.won/,
    'offline_conversion_queue.action must stay tied to Won conversion name'
  );
  assert.ok(
    !src.includes('OPSMANTIK_CONVERSION_NAMES.contacted') &&
      !src.includes('OPSMANTIK_CONVERSION_NAMES.offered') &&
      !src.includes('OPSMANTIK_CONVERSION_NAMES.junk'),
    'seal enqueue must not reference upper-funnel conversion names'
  );
});

test('Apps Script engines share the four literal conversion names', () => {
  const must = [
    'OpsMantik_Contacted',
    'OpsMantik_Offered',
    'OpsMantik_Won',
    'OpsMantik_Junk_Exclusion',
  ];
  const gas = readFileSync(
    join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScript.js'),
    'utf8'
  );
  const tec = readFileSync(
    join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptTecrubeliBakici.js'),
    'utf8'
  );
  const mur = readFileSync(
    join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptMuratcanAku.js'),
    'utf8'
  );
  for (const m of must) {
    assert.ok(gas.includes(`'${m}'`), `GoogleAdsScript.js missing ${m}`);
    assert.ok(tec.includes(`'${m}'`), `GoogleAdsScriptTecrubeliBakici.js missing ${m}`);
    assert.ok(mur.includes(`'${m}'`), `GoogleAdsScriptMuratcanAku.js missing ${m}`);
  }
});
