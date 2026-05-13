import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptUniversal.js');

function readUniversal(): string {
  return readFileSync(scriptPath, 'utf8');
}

test('PR-9K: Universal sendAck sets dispatch-pending ACK flags (not provider-confirmed)', () => {
  const src = readUniversal();
  assert.ok(src.includes('pendingConfirmation: true'), 'sendAck must set pendingConfirmation');
  assert.ok(src.includes('providerConfirmationMode'), 'sendAck must name providerConfirmationMode');
  assert.ok(
    src.includes("'bulk_upload_async_unconfirmed'") || src.includes('"bulk_upload_async_unconfirmed"'),
    'sendAck must set bulk_upload_async_unconfirmed mode'
  );
});

test('PR-9K: loadConfig getVal checks inline first, then Script Properties', () => {
  const src = readUniversal();
  const fnStart = src.indexOf('function getVal(inlineVal, propKey, fallback)');
  assert.ok(fnStart >= 0, 'getVal not found');
  const bodyStart = src.indexOf('{', fnStart);
  const iInline = src.indexOf('inlineVal', bodyStart);
  const iProps = src.indexOf('getProperty(propKey)', bodyStart);
  assert.ok(iInline >= 0 && iProps >= 0, 'getVal must reference inline and Script Properties');
  assert.ok(iInline < iProps, 'inline must be evaluated before Script Properties lookup');
});

test('PR-9K: sendAck is dispatch-only (no failed rows); no payload.results in ACK', () => {
  const src = readUniversal();
  assert.match(
    src,
    /OciClient\.prototype\.sendAck\s*=\s*function\s*\(\s*siteId\s*,\s*queueIds\s*,\s*skippedIds\s*,\s*exportRunId\s*\)/,
    'sendAck signature must be (siteId, queueIds, skippedIds, exportRunId)'
  );
  assert.ok(!/sendAck\s*=\s*function\s*\([^)]*failedRows/.test(src), 'sendAck must not take failedRows');
  assert.ok(!src.includes('payload.results'), 'ACK payload must not embed row-level results');
});

test('PR-9K: validation failures use sendAckFailed with VALIDATION, not mixed into sendAck', () => {
  const src = readUniversal();
  assert.match(
    src,
    /client\.sendAckFailed\s*\(\s*cfg\.SITE_ID\s*,\s*\[f\.id\]\s*,\s*f\.code\s*,\s*f\.code\s*,\s*'VALIDATION'\s*,\s*exportRunId\s*\)/
  );
  const ackCallIdx = src.indexOf('client.sendAck(');
  assert.ok(ackCallIdx >= 0, 'client.sendAck call not found');
  const ackSlice = src.slice(ackCallIdx, ackCallIdx + 400);
  assert.ok(!ackSlice.includes('failedRows'), 'sendAck call must not pass failedRows');
});

test('PR-9K: Universal does not claim provider-side confirmation counts on script success path', () => {
  const src = readUniversal();
  assert.ok(!src.includes('provider_confirmed_count'), 'Universal must not track provider_confirmed_count in-script');
});

test('PR-9K: after upload.apply success, ACK failure is logged as ambiguous (no page-wide ack-failed for success ids)', () => {
  const src = readUniversal();
  assert.ok(
    src.includes('ACK dispatch failed after upload.apply') || src.includes('ACK returned ok=false'),
    'ambiguous ACK path must be explicit in logs'
  );
});
