/**
 * L15–L17: producer insert retry + outbox payload correlation (source contract; no DB).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENQUEUE = join(process.cwd(), 'lib', 'oci', 'enqueue-panel-stage-outbox.ts');
const EXPORT_AUTH = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-auth.ts');

test('L17: outbox payload includes request_id when options pass requestId', () => {
  const src = readFileSync(ENQUEUE, 'utf8');
  assert.ok(
    src.includes('...(requestId ? { request_id: requestId } : {})'),
    'payload must embed request_id for log ↔ row correlation'
  );
  assert.match(
    src,
    /options\?\.requestId/,
    'enqueue must read requestId from PanelStageOciEnqueueOptions'
  );
});

test('L15: at most one retry on transient PG insert errors only', () => {
  const src = readFileSync(ENQUEUE, 'utf8');
  assert.ok(src.includes('for (let attempt = 0; attempt < 2; attempt++)'), 'max two insert attempts per request');
  assert.ok(src.includes('isTransientOutboxInsertError'), 'retry gated on transient classification');
  assert.ok(
    /\['40001', '40P01', '57014', '55P03', '08006'\]/.test(src),
    'transient code allowlist must remain explicit'
  );
  assert.ok(!/\bnotifyOutboxPending\s*\(/.test(src), 'enqueue must not invoke notify — order is route-owned');
});

test('L16: export auth uses oci-google-ads-export rate limit namespace', () => {
  const src = readFileSync(EXPORT_AUTH, 'utf8');
  assert.ok(src.includes("'oci-google-ads-export'"), 'authenticated export must use oci-google-ads-export namespace');
  assert.ok(src.includes("'oci-authfail'"), 'unauthenticated probe path must use oci-authfail namespace');
});
