/**
 * Guard: all four canonical conversion names are represented in the queue journal.
 * Won is still owned by seal enqueue; contacted/offered/junk are emitted by micro-stage enqueue.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('enqueueSealConversion inserts offline queue with OpsMantik_Won only', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
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

test('enqueueOciConversionRow maps micro stages to canonical queue actions', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'enqueue-oci-conversion-row.ts'), 'utf8');
  assert.ok(
    src.includes('const actionName = OPSMANTIK_CONVERSION_NAMES[stage]'),
    'micro-stage queue writer must derive action from canonical conversion names'
  );
  assert.ok(
    src.includes('enqueueIntentConversionJournalRow'),
    'micro stages must unify on intent journal enqueue (queue SSOT)'
  );
  const contract = readFileSync(
    join(process.cwd(), 'lib', 'oci', 'intent-conversion-journal-contract.ts'),
    'utf8'
  );
  assert.ok(
    contract.includes('BLOCKED_PRECEDING_SIGNALS') && contract.includes('MISSING_CLICK_ID'),
    'missing click must remain explicit via journal disposition planner'
  );
});

test('stage-router enqueues contacted/offered/junk into queue journal', () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'stages', 'stage-router.ts'),
    'utf8'
  );
  assert.ok(
    src.includes('ensureOciQueueEnqueue'),
    'stage router must route fired micro stages into offline_conversion_queue journal'
  );
  assert.ok(
    src.includes("queue_reason: 'CONSENT_MISSING'") && src.includes('queue_parity_result'),
    'consent miss should be explicit in route result semantics'
  );
});

test('Canonical Apps Script (Universal) carries the four literal conversion names', () => {
  const must = ['OpsMantik_Contacted', 'OpsMantik_Offered', 'OpsMantik_Won', 'OpsMantik_Junk_Exclusion'];
  const universal = readFileSync(
    join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptUniversal.js'),
    'utf8'
  );
  for (const m of must) {
    assert.ok(universal.includes(`'${m}'`), `GoogleAdsScriptUniversal.js missing ${m}`);
  }
});
