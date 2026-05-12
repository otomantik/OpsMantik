import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCourierZodArmorToConversionItem,
  googleAdsSha256Hex64Schema,
  jitExportRpcRowSchema,
  parseJitExportRpcRowsStrict,
} from '@/lib/oci/validation/google-ads-hashed-identifiers.zod';

const HP = '0123456789abcdef'.repeat(4);

test('googleAdsSha256Hex64Schema rejects uppercase hex', () => {
  const bad = HP.toUpperCase();
  assert.equal(googleAdsSha256Hex64Schema.safeParse(bad).success, false);
});

test('parseJitExportRpcRowsStrict accepts minimal JIT row', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    site_id: '00000000-0000-4000-8000-000000000002',
    sale_id: null,
    call_id: '00000000-0000-4000-8000-000000000003',
    session_id: null,
    gclid: 'x',
    wbraid: null,
    gbraid: null,
    user_identifiers: null,
    provider_path: null,
    conversion_time: '2026-05-05T10:00:00.000Z',
    occurred_at: null,
    created_at: null,
    updated_at: null,
    value_cents: 100,
    optimization_stage: null,
    optimization_value: null,
    currency: 'TRY',
    action: 'OpsMantik_Won',
    external_id: 'ext',
    provider_key: 'google_ads',
    jit_call_status: 'intent',
    jit_call_oci_status: null,
    jit_call_matched_session_id: null,
    jit_call_created_at: null,
    jit_call_confirmed_at: null,
    jit_caller_phone_hash_sha256: HP,
  };
  const out = parseJitExportRpcRowsStrict([row]);
  assert.equal(out.length, 1);
  assert.equal(out[0].jit_caller_phone_hash_sha256, HP);
});

test('jitExportRpcRowSchema fails on invalid jit hash', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    site_id: '00000000-0000-4000-8000-000000000002',
    sale_id: null,
    call_id: null,
    session_id: null,
    gclid: null,
    wbraid: null,
    gbraid: null,
    user_identifiers: null,
    provider_path: null,
    conversion_time: '2026-05-05T10:00:00.000Z',
    value_cents: 1,
    external_id: 'e',
    jit_caller_phone_hash_sha256: 'not64hex',
  };
  assert.throws(() => parseJitExportRpcRowsStrict([row]), /OCI_EXPORT_JIT_ROW/);
});

test('applyCourierZodArmor strips bad phone but keeps gclid', () => {
  const item = applyCourierZodArmorToConversionItem({
    gclid: 'abc',
    wbraid: '',
    gbraid: '',
    hashedPhoneNumber: 'bad',
    conversionTime: 't',
  } as never);
  assert.equal((item as { gclid?: string }).gclid, 'abc');
  assert.equal((item as { hashedPhoneNumber?: string }).hashedPhoneNumber, undefined);
});

test('jitExportRpcRowSchema ignores unknown keys (strip)', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    site_id: '00000000-0000-4000-8000-000000000002',
    sale_id: null,
    call_id: null,
    session_id: null,
    gclid: null,
    wbraid: null,
    gbraid: null,
    user_identifiers: null,
    provider_path: null,
    conversion_time: '2026-05-05T10:00:00.000Z',
    value_cents: 1,
    external_id: 'e',
    extra_field: 'nope',
  };
  const r = jitExportRpcRowSchema.safeParse(row);
  assert.equal(r.success, true);
  if (r.success) assert.equal('extra_field' in r.data, false);
});
