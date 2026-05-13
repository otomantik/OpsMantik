/**
 * OCI Universal script: upload.apply() exception path uses ack-failed (TRANSIENT), not success ACK.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptUniversal.js');

test('GoogleAdsScriptUniversal: upload.apply wrapped in try/catch', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('try'));
  assert.ok(src.includes('upload.apply()'));
  assert.ok(src.includes('catch'));
});

test('GoogleAdsScriptUniversal: on apply catch calls sendAckFailed with UPLOAD_EXCEPTION and TRANSIENT', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('sendAckFailed'));
  assert.ok(src.includes("'UPLOAD_EXCEPTION'") || src.includes('"UPLOAD_EXCEPTION"'));
  assert.ok(src.includes("'TRANSIENT'") || src.includes('"TRANSIENT"'));
});

test('GoogleAdsScriptUniversal: upload failure path returns before success ACK', () => {
  const src = readFileSync(scriptPath, 'utf8');
  const catchIdx = src.indexOf("Log.error('upload.apply() FAILED'");
  assert.ok(catchIdx >= 0);
  const tryIdx = src.lastIndexOf('// ── Phase 4: Single upload.apply()', catchIdx);
  assert.ok(tryIdx >= 0);
  const phase4 = src.slice(tryIdx, tryIdx + 900);
  assert.match(phase4, /catch\s*\([^)]*\)\s*\{[\s\S]*?\breturn\b/);
});

test('GoogleAdsScriptUniversal: success ACK only after uploadOk guard', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('if (uploadOk && successIds.length)'), 'must gate sendAck on uploadOk');
});

test('GoogleAdsScriptUniversal: sendAck accepts skippedIds in payload', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('skippedIds'));
  assert.ok(src.includes('payload.skippedIds') || src.includes('payload.skippedIds ='));
  const sendAckIdx = src.indexOf('OciClient.prototype.sendAck');
  assert.ok(sendAckIdx >= 0);
  const sendAckSlice = src.slice(sendAckIdx, sendAckIdx + 800);
  assert.ok(sendAckSlice.includes('skippedIds'), 'sendAck must accept skippedIds');
});

test('GoogleAdsScriptUniversal: fetchPage maps API meta to nextCursor / hasNextPage', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('fetchPage'));
  assert.ok(src.includes('nextCursor') && src.includes('hasNextPage'));
});
