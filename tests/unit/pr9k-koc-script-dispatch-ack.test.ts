import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('PR-9K: Koç Google Ads Script sends dispatch-pending ACK flags (not provider-confirmed-only)', () => {
  const p = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptKocOtoKurtarma.js');
  const src = readFileSync(p, 'utf8');
  assert.ok(src.includes('payload.pendingConfirmation = true'), 'sendAck must set pendingConfirmation');
  assert.ok(
    src.includes("'bulk_upload_async_unconfirmed'") || src.includes('"bulk_upload_async_unconfirmed"'),
    'sendAck must set providerConfirmationMode'
  );
  assert.ok(src.includes('GOOGLE_BULK_UPLOAD_PROVIDER_CONFIRMATION_PENDING'), 'telemetry line required');
});
