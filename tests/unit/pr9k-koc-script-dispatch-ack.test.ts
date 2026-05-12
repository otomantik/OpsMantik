import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptKocOtoKurtarma.js');

function readKocScript(): string {
  return readFileSync(scriptPath, 'utf8');
}

test('PR-9K: Koç Google Ads Script sends dispatch-pending ACK flags (not provider-confirmed-only)', () => {
  const src = readKocScript();
  assert.ok(src.includes('payload.pendingConfirmation = true'), 'sendAck must set pendingConfirmation');
  assert.ok(
    src.includes("'bulk_upload_async_unconfirmed'") || src.includes('"bulk_upload_async_unconfirmed"'),
    'sendAck must set providerConfirmationMode'
  );
  assert.ok(src.includes('GOOGLE_BULK_UPLOAD_PROVIDER_CONFIRMATION_PENDING'), 'telemetry line required');
});

test('PR-9K: getFirst resolves Script Properties before process.env before inline (export limit / max sync pages)', () => {
  const src = readKocScript();
  const cfgStart = src.indexOf('function getScriptConfig()');
  assert.ok(cfgStart >= 0, 'getScriptConfig not found');
  const getFirstStart = src.indexOf('const getFirst = function', cfgStart);
  assert.ok(getFirstStart >= 0, 'getFirst not found');
  const getFirstEnd = src.indexOf('};', getFirstStart);
  assert.ok(getFirstEnd > getFirstStart, 'getFirst block end not found');
  const getFirstBody = src.slice(getFirstStart, getFirstEnd + 2);
  const iProps = getFirstBody.indexOf('props.getProperty');
  const iEnv = getFirstBody.indexOf('process.env');
  const iInline = getFirstBody.indexOf('getInlineForKeys');
  assert.ok(iProps >= 0 && iEnv >= 0 && iInline >= 0, 'getFirst must reference props, env, and inline');
  assert.ok(iProps < iEnv, 'Script Properties must be checked before process.env');
  assert.ok(iEnv < iInline, 'process.env must be checked before inline fallback');
});

test('PR-9K: sendAck signature is dispatch-only (no failedRows); no payload.results in ACK', () => {
  const src = readKocScript();
  assert.match(
    src,
    /KocOtoClient\.prototype\.sendAck\s*=\s*function\s*\(\s*siteId\s*,\s*queueIds\s*,\s*skippedIds\s*,\s*exportRunId\s*\)/,
    'sendAck must be (siteId, queueIds, skippedIds, exportRunId)'
  );
  assert.ok(!/sendAck\s*=\s*function\s*\([^)]*failedRows/.test(src), 'sendAck must not take failedRows');
  assert.ok(!src.includes('payload.results'), 'ACK payload must not embed row-level results');
});

test('PR-9K: validation failures use sendAckFailed with VALIDATION, not mixed into sendAck', () => {
  const src = readKocScript();
  assert.ok(
    src.includes("failed.errorCategory || 'VALIDATION'"),
    'validation ack-failed path must default category to VALIDATION'
  );
  assert.ok(
    src.includes('[failed.queueId]'),
    'per-row validation must target single queue id array for ack-failed'
  );
  const ackCallIdx = src.indexOf('client.sendAck(');
  assert.ok(ackCallIdx >= 0, 'client.sendAck call not found');
  const ackSlice = src.slice(ackCallIdx, ackCallIdx + 400);
  assert.ok(!ackSlice.includes('stats.failedRows'), 'sendAck call must not pass stats.failedRows');
});

test('PR-9K: run summary keeps provider_confirmed_count at 0 after upload.apply dispatch', () => {
  const src = readKocScript();
  assert.ok(
    /provider_confirmed_count:\s*0/.test(src),
    'summaryStats must initialize provider_confirmed_count to 0'
  );
  assert.ok(
    !src.includes('provider_confirmed_count +='),
    'script must not increment provider_confirmed_count during bulk dispatch'
  );
});

test('PR-9K: change ticket default inline is PR-9K-KOC-REQUEUE-REDRAIN', () => {
  const src = readKocScript();
  assert.ok(
    src.includes("OPSMANTIK_INLINE_CHANGE_TICKET = 'PR-9K-KOC-REQUEUE-REDRAIN'"),
    'inline change ticket must track PR-9K redrain workstream'
  );
});

test('PR-9K: resolveRunMode prefers Script Properties, then env, then inline', () => {
  const src = readKocScript();
  const fnStart = src.indexOf('function resolveRunMode()');
  assert.ok(fnStart >= 0);
  const rawBlock = src.indexOf('const raw = String(', fnStart);
  assert.ok(rawBlock > fnStart);
  const rawEnd = src.indexOf(').toLowerCase();', rawBlock);
  assert.ok(rawEnd > rawBlock);
  const rawExpr = src.slice(rawBlock, rawEnd);
  const iProp = rawExpr.indexOf('propMode.trim()');
  const iEnv = rawExpr.indexOf('envMode');
  const iInline = rawExpr.indexOf('inlineMode');
  assert.ok(iProp >= 0 && iEnv >= 0 && iInline >= 0);
  assert.ok(iProp < iEnv && iEnv < iInline, 'resolveRunMode order: props, env, inline');
});

test('PR-9K: upload.apply failure path ack-fails validation failedRows (vfail) plus uploadable successIds via onUploadFailure', () => {
  const src = readKocScript();
  assert.ok(
    src.includes('onUploadFailure: function') && src.includes('return client.sendAckFailed'),
    'processPageUpload must wire upload exceptions to ack-failed for successIds'
  );
  const uploadFailIdx = src.indexOf('if (stats.uploadFailed)');
  assert.ok(uploadFailIdx >= 0);
  const sliceToContinue = src.slice(uploadFailIdx, uploadFailIdx + 2200);
  assert.ok(
    sliceToContinue.includes('[vfail.queueId]') && sliceToContinue.includes("vfail.errorCategory || 'VALIDATION'"),
    'uploadFailed branch must send per-row VALIDATION ack-failed for stats.failedRows'
  );
});

test('PR-9K: after upload.apply success, sendAck failure uses ambiguous marker — no page-wide ack-failed', () => {
  const src = readKocScript();
  assert.ok(
    src.includes('ACK_FAILED_AFTER_UPLOAD_APPLY_PROVIDER_AMBIGUOUS_NO_ACK_FAILED_SENT'),
    'ambiguous dispatch ACK must emit dedicated telemetry'
  );
  assert.ok(
    src.includes('opsmantikNoPageAckFailed'),
    'ambiguous path must tag error to skip page-wide ACK_FAILED'
  );
  const guardIdx = src.indexOf('if (err && err.opsmantikNoPageAckFailed)');
  assert.ok(guardIdx >= 0, 'ambiguous ACK guard in page catch not found');
  const catchStart = src.lastIndexOf('} catch (err) {', guardIdx);
  assert.ok(catchStart >= 0 && catchStart < guardIdx);
  const catchSlice = src.slice(catchStart, catchStart + 2600);
  assert.ok(
    catchSlice.includes('opsmantikNoPageAckFailed') && catchSlice.includes('client.sendAckFailed'),
    'catch block must reference both ambiguous guard and page-wide ack-failed'
  );
  assert.ok(
    catchSlice.indexOf('opsmantikNoPageAckFailed') < catchSlice.indexOf('const ids = (page.items'),
    'opsmantikNoPageAckFailed must be handled before building page-wide id list'
  );
});

test('PR-9K: Koç inline redrain caps export limit and drain batch to 25', () => {
  const src = readKocScript();
  assert.ok(
    src.includes("OPSMANTIK_INLINE_EXPORT_LIMIT = '25'"),
    'inline export limit fallback should be 25'
  );
  assert.ok(
    src.includes("OPSMANTIK_INLINE_DRAIN_MAX_BATCH_SIZE = '25'"),
    'inline drain max batch should match export cap (25)'
  );
});

test('PR-9K: per-page success path sends validation ack-failed before dispatch sendAck', () => {
  const src = readKocScript();
  const uas = src.indexOf('var uploadApplySucceeded = stats.uploaded > 0 && !stats.uploadFailed;');
  assert.ok(uas >= 0, 'uploadApplySucceeded marker required');
  const fromUas = src.slice(uas, uas + 1200);
  const iValLoop = fromUas.indexOf('if (stats.failedRows.length)');
  const iSendAck = fromUas.indexOf('ackRes = client.sendAck(');
  assert.ok(iValLoop >= 0 && iSendAck >= 0, 'validation loop and sendAck must follow uploadApplySucceeded');
  assert.ok(iValLoop < iSendAck, 'VALIDATION ack-failed rows must be sent before dispatch-pending sendAck');
});
