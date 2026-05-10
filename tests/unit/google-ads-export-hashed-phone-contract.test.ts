import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueueItems } from '@/app/api/oci/google-ads-export/export-build-queue';

const ctx = { site: { timezone: 'UTC', currency: 'USD' } } as never;

const VALID_HP = '0123456789abcdef'.repeat(4);

function baseQueueRow(overrides: Record<string, unknown>) {
  return {
    id: 'q-hp',
    call_id: 'c-hp',
    occurred_at: '2026-05-05T10:00:00.000Z',
    conversion_time: '2026-05-05T10:00:00.000Z',
    created_at: '2026-05-05T10:00:00.000Z',
    value_cents: 100,
    optimization_value: 1,
    currency: 'USD',
    provider_key: 'google_ads',
    sale_id: null,
    session_id: 's1',
    gclid: 'g-valid',
    wbraid: null,
    gbraid: null,
    external_id: 'ext-hp',
    action: 'OpsMantik_Won',
    ...overrides,
  };
}

test('export item: hashedPhoneNumber from queue user_identifiers.hashed_phone', () => {
  const built = buildQueueItems(
    ctx,
    [
      baseQueueRow({
        user_identifiers: { hashed_phone: VALID_HP, normalization_version: 'e164_sha256_v1' },
      }),
    ] as never,
    {},
    {},
    {}
  );
  assert.equal(built.conversions.length, 1);
  const item = built.conversions[0];
  assert.equal(item.hashedPhoneNumber, VALID_HP);
  assert.deepEqual(item.userIdentifiers, [{ type: 'hashed_phone', value: VALID_HP }]);
  assert.equal(built.hashedPhoneDiagnostics.hashed_phone_available_count, 1);
});

test('export item: hashedPhoneNumber from calls.caller_phone_hash_sha256 when queue omits identifiers', () => {
  const built = buildQueueItems(ctx, [baseQueueRow({ user_identifiers: null })] as never, {}, {}, {
    'c-hp': VALID_HP,
  });
  assert.equal(built.conversions.length, 1);
  assert.equal(built.conversions[0].hashedPhoneNumber, VALID_HP);
});

test('export item: resolution prefers queue hashed_phone over call hash when equal', () => {
  const other = 'fedcba0987654321'.repeat(4);
  const built = buildQueueItems(
    ctx,
    [baseQueueRow({ user_identifiers: { hashed_phone: VALID_HP } })] as never,
    {},
    {},
    { 'c-hp': other }
  );
  assert.equal(built.conversions[0].hashedPhoneNumber, VALID_HP);
});

test('export item: invalid hashed_phone still tries hashedPhoneNumber then call hash (PR-9H.7C order)', () => {
  const alt = 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321';
  const built = buildQueueItems(
    ctx,
    [
      baseQueueRow({
        id: 'q-order',
        call_id: 'c-order',
        user_identifiers: { hashed_phone: 'bad', hashedPhoneNumber: alt },
      }),
    ] as never,
    {},
    {},
    {}
  );
  assert.equal(built.conversions[0].hashedPhoneNumber, alt);

  const built2 = buildQueueItems(
    ctx,
    [baseQueueRow({ id: 'q-order2', call_id: 'c-order2', user_identifiers: { hashed_phone: 'bad' } })] as never,
    {},
    {},
    { 'c-order2': VALID_HP }
  );
  assert.equal(built2.conversions[0].hashedPhoneNumber, VALID_HP);
});

test('invalid hash hex is never emitted', () => {
  const built = buildQueueItems(
    ctx,
    [
      baseQueueRow({
        user_identifiers: { hashed_phone: 'zzz' },
      }),
      baseQueueRow({
        id: 'q-hp2',
        call_id: 'c-hp2',
        user_identifiers: null,
      }),
    ] as never,
    {},
    {},
    { 'c-hp2': `${'zz'.repeat(32)}` }
  );
  assert.equal(built.conversions.length, 2);
  assert.equal(built.conversions[0].hashedPhoneNumber, undefined);
  assert.equal(built.conversions[1].hashedPhoneNumber, undefined);
  assert.ok(built.hashedPhoneDiagnostics.hashed_phone_invalid_count >= 2);
});

test('export item JSON must not include raw phone fields', () => {
  const built = buildQueueItems(
    ctx,
    [
      baseQueueRow({
        user_identifiers: { hashed_phone: VALID_HP },
      }),
    ] as never,
    {},
    {},
    {}
  );
  const json = JSON.stringify(built.conversions[0]);
  assert.doesNotMatch(json, /caller_phone_raw/i);
  assert.doesNotMatch(json, /caller_phone[^_]/i);
});
