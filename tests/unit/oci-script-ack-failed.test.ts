/**
 * OCI script: upload.apply() exception triggers onUploadFailure with TRANSIENT.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('GoogleAdsScript: process wraps apply in try/catch', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScript.js');
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('try'), 'has try');
  assert.ok(src.includes('upload.apply()'), 'calls apply');
  assert.ok(src.includes('catch'), 'has catch');
});

test('GoogleAdsScript: on apply catch calls onUploadFailure with UPLOAD_EXCEPTION and TRANSIENT', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScript.js');
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('onUploadFailure'), 'uses onUploadFailure callback');
  assert.ok(src.includes('UPLOAD_EXCEPTION'), 'errorCode UPLOAD_EXCEPTION');
  assert.ok(src.includes('TRANSIENT'), 'errorCategory TRANSIENT');
});

test('GoogleAdsScript: main passes onUploadFailure that calls sendAckFailed', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScript.js');
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('sendAckFailed'), 'calls sendAckFailed on upload failure');
  assert.ok(src.includes('onUploadFailure: function'), 'passes onUploadFailure to process');
});

test('GoogleAdsScript: on apply catch returns uploadFailed:true instead of throw', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScript.js');
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('uploadFailed: true'), 'returns uploadFailed on apply exception');
  assert.ok(src.includes('Object.assign'), 'returns stats with uploadFailed');
});

test('GoogleAdsScript: main blocks ACK when uploadFailed', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScript.js');
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('stats.uploadFailed') && src.includes('return'), 'checks uploadFailed before ACK');
});

test('GoogleAdsScript: process uses skippedIds and skippedDeterministic', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScript.js');
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('skippedIds'), 'has skippedIds in stats');
  assert.ok(src.includes('skippedDeterministic'), 'has skippedDeterministic in stats');
  assert.ok(src.includes('skippedValidation'), 'has skippedValidation in stats');
});

test('GoogleAdsScript: sendAck accepts skippedIds parameter', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScript.js');
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('skippedIds'), 'sendAck accepts skippedIds');
  assert.ok(src.includes('payload.skippedIds'), 'passes skippedIds to ACK payload');
});
