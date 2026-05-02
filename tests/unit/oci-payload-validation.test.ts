import test from 'node:test';
import assert from 'node:assert';
import { normalizeOciConversionTimeUtcZ, safeValidateOciPayload } from '../../lib/oci/validation/payload';

test('Zod Validation: accepts valid OCI payload', () => {
  const valid = {
    click_id: 'GCLID_EX_1234567890',
    conversion_value: 150.50,
    currency: 'TRY',
    conversion_time: '2026-04-21T10:00:00Z',
    site_id: '00000000-0000-0000-0000-000000000001',
    stage: 'won',
    metadata: { test: true }
  };

  const result = safeValidateOciPayload(valid);
  assert.strictEqual(result.success, true, 'Valid payload should be accepted');
  if (result.success) {
    assert.strictEqual(result.data.click_id, valid.click_id);
    assert.strictEqual(result.data.conversion_value, 150.50);
  }
});

test('Zod Validation: rejects short click_id', () => {
  const invalid = {
    click_id: '123', // Too short
    conversion_value: 10,
    currency: 'USD',
    conversion_time: '2026-04-21T10:00:00Z',
    site_id: '00000000-0000-0000-0000-000000000001',
    stage: 'won'
  };

  const result = safeValidateOciPayload(invalid);
  assert.strictEqual(result.success, false);
  if (!result.success) {
    assert.ok(result.error.errors.some(e => e.message.includes('at least 10 characters')));
  }
});

test('Zod Validation: rejects negative conversion_value', () => {
  const invalid = {
    click_id: 'GCLID_EX_1234567890',
    conversion_value: -1,
    currency: 'USD',
    conversion_time: '2026-04-21T10:00:00Z',
    site_id: '00000000-0000-0000-0000-000000000001',
    stage: 'won'
  };

  const result = safeValidateOciPayload(invalid);
  assert.strictEqual(result.success, false);
});

test('Zod Validation: rejects invalid currency format', () => {
  const invalid = {
    click_id: 'GCLID_EX_1234567890',
    conversion_value: 10,
    currency: 'try', // lowercase not allowed
    conversion_time: '2026-04-21T10:00:00Z',
    site_id: '00000000-0000-0000-0000-000000000001',
    stage: 'won'
  };

  const result = safeValidateOciPayload(invalid);
  assert.strictEqual(result.success, false);
});

test('Zod Validation: rejects invalid ISO date', () => {
  const invalid = {
    click_id: 'GCLID_EX_1234567890',
    conversion_value: 10,
    currency: 'USD',
    conversion_time: '2026-04-21 10:00', // Not ISO 8601
    site_id: '00000000-0000-0000-0000-000000000001',
    stage: 'won'
  };

  const result = safeValidateOciPayload(invalid);
  assert.strictEqual(result.success, false);
});

test('normalizeOciConversionTimeUtcZ accepts Postgres offset timestamps for Zod pipeline', () => {
  const raw = '2026-05-02T13:24:24.591922+00:00';
  const z = normalizeOciConversionTimeUtcZ(raw);
  assert.ok(z?.endsWith('Z'));
  const r = safeValidateOciPayload({
    click_id: 'GCLID_EX_1234567890',
    conversion_value: 0,
    currency: 'TRY',
    conversion_time: z as string,
    site_id: '00000000-0000-0000-0000-000000000001',
    stage: 'won',
  });
  assert.strictEqual(r.success, true);
});
