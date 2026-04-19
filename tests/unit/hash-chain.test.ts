/**
 * Hash-chain round-trip tests for `lib/oci/marketing-signal-hash.ts`.
 *
 * The VOID ledger chains every `marketing_signals.current_hash` via
 *   sha256( callId : sequence : expectedValueCents : previousHash : salt )
 * and the integrity of the whole OCI export audit rests on:
 *   1) Determinism   — same inputs ⇒ identical hash (otherwise replay breaks).
 *   2) Sensitivity   — any input delta ⇒ different hash (otherwise tampering
 *      anywhere along the chain goes undetected).
 *   3) Chain linkage — flipping `previousHash` alone must change the current
 *      hash (that is what makes the ledger append-only).
 *   4) Cents floor   — `toExpectedValueCents` must never emit 0, or the hash
 *      would stop separating "no sale yet" from "zero-value sale".
 *
 * All tests are pure: they run against the dev-only salt that
 * `getVoidLedgerSalt()` returns when NODE_ENV !== 'production'.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  computeMarketingSignalCurrentHash,
  toExpectedValueCents,
  resetVoidLedgerSaltCacheForTests,
} from '@/lib/oci/marketing-signal-hash';

const BASE_PARAMS = {
  callId: 'call-aaaa-bbbb',
  sequence: 0,
  expectedValueCents: 1_500,
  previousHash: null as string | null,
};

// ---------------------------------------------------------------------------
// 1) Determinism — same inputs produce the same hash byte-for-byte
// ---------------------------------------------------------------------------

test('computeMarketingSignalCurrentHash is deterministic', () => {
  const a = computeMarketingSignalCurrentHash(BASE_PARAMS);
  const b = computeMarketingSignalCurrentHash(BASE_PARAMS);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/, 'must be a 64-char lowercase hex sha256');
});

// ---------------------------------------------------------------------------
// 2) Sensitivity — every input field must influence the hash
// ---------------------------------------------------------------------------

test('hash is sensitive to callId', () => {
  const a = computeMarketingSignalCurrentHash(BASE_PARAMS);
  const b = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, callId: 'other-call' });
  assert.notEqual(a, b);
});

test('hash is sensitive to sequence', () => {
  const a = computeMarketingSignalCurrentHash(BASE_PARAMS);
  const b = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, sequence: 1 });
  assert.notEqual(a, b);
});

test('hash is sensitive to expectedValueCents', () => {
  const a = computeMarketingSignalCurrentHash(BASE_PARAMS);
  const b = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, expectedValueCents: 1_501 });
  assert.notEqual(a, b);
});

test('hash distinguishes null callId from literal "null" string', () => {
  const a = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, callId: null });
  const b = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, callId: 'null' });
  // Both stringify the same way in the payload template, so this pins that the
  // template choice is documented: they SHOULD collide until we add a type
  // discriminator. If you change the payload format, update this assertion.
  assert.equal(a, b, 'current template collides null and literal "null" — documented quirk');
});

// ---------------------------------------------------------------------------
// 3) Chain linkage — previousHash must propagate
// ---------------------------------------------------------------------------

test('flipping previousHash changes the current hash', () => {
  const root = computeMarketingSignalCurrentHash(BASE_PARAMS);
  const next = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, sequence: 1, previousHash: root });
  const tampered = computeMarketingSignalCurrentHash({
    ...BASE_PARAMS,
    sequence: 1,
    previousHash: 'a'.repeat(64),
  });
  assert.notEqual(next, tampered, 'tampering with previousHash must be detectable');
});

test('three-step chain is fully linked', () => {
  const h0 = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, sequence: 0, previousHash: null });
  const h1 = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, sequence: 1, previousHash: h0 });
  const h2 = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, sequence: 2, previousHash: h1 });

  const seen = new Set([h0, h1, h2]);
  assert.equal(seen.size, 3, 'every link in the chain must be unique');

  // Forensic replay: recomputing from the same inputs must reproduce the chain.
  const replay0 = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, sequence: 0, previousHash: null });
  const replay1 = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, sequence: 1, previousHash: replay0 });
  const replay2 = computeMarketingSignalCurrentHash({ ...BASE_PARAMS, sequence: 2, previousHash: replay1 });
  assert.equal(replay0, h0);
  assert.equal(replay1, h1);
  assert.equal(replay2, h2);
});

// ---------------------------------------------------------------------------
// 4) Salt participation — rotating salt must change every hash
// ---------------------------------------------------------------------------

test('hash changes when VOID_LEDGER_SALT is rotated', () => {
  const prev = process.env.VOID_LEDGER_SALT;
  try {
    process.env.VOID_LEDGER_SALT = 'salt-rotation-A';
    resetVoidLedgerSaltCacheForTests();
    const a = computeMarketingSignalCurrentHash(BASE_PARAMS);

    process.env.VOID_LEDGER_SALT = 'salt-rotation-B';
    resetVoidLedgerSaltCacheForTests();
    const b = computeMarketingSignalCurrentHash(BASE_PARAMS);

    assert.notEqual(a, b, 'salt rotation must break the existing chain (by design)');
  } finally {
    if (prev === undefined) delete process.env.VOID_LEDGER_SALT;
    else process.env.VOID_LEDGER_SALT = prev;
    resetVoidLedgerSaltCacheForTests();
  }
});

// ---------------------------------------------------------------------------
// 5) Payload shape pin — recompute hash via independent sha256 to catch
//    accidental changes to the separator or ordering of fields
// ---------------------------------------------------------------------------

test('hash payload format is callId:sequence:expectedValueCents:previousHash:salt', () => {
  const prev = process.env.VOID_LEDGER_SALT;
  try {
    process.env.VOID_LEDGER_SALT = 'pin-salt';
    resetVoidLedgerSaltCacheForTests();
    const params = { callId: 'c-1', sequence: 7, expectedValueCents: 42, previousHash: 'p-hash' };
    const got = computeMarketingSignalCurrentHash(params);
    const expected = createHash('sha256')
      .update('c-1:7:42:p-hash:pin-salt')
      .digest('hex');
    assert.equal(got, expected, 'payload template drifted — check marketing-signal-hash.ts');
  } finally {
    if (prev === undefined) delete process.env.VOID_LEDGER_SALT;
    else process.env.VOID_LEDGER_SALT = prev;
    resetVoidLedgerSaltCacheForTests();
  }
});

// ---------------------------------------------------------------------------
// 6) toExpectedValueCents — floor at 1 even for zero / negative / NaN inputs
// ---------------------------------------------------------------------------

test('toExpectedValueCents floors at 1', () => {
  assert.equal(toExpectedValueCents(0), 1);
  assert.equal(toExpectedValueCents(-5), 1);
  assert.equal(toExpectedValueCents(0.004), 1, 'sub-cent values still floor at 1');
});

test('toExpectedValueCents rounds to nearest cent', () => {
  assert.equal(toExpectedValueCents(1.239), 124, '1.239 → 1.239*100 = 123.9 → round = 124');
  assert.equal(toExpectedValueCents(12.345), 1235, 'banker/half-up rounding: 12.345 → 1234.5 → 1235');
  assert.equal(toExpectedValueCents(99.99), 9999);
});
