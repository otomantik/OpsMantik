/**
 * Unit tests for OCI Config logic.
 *
 * Star-based gating (min_star, weights) has been removed.
 * V5 value is driven by saleAmount when known, otherwise canonical fallback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOciConfig, computeConversionValue, OCI_DEFAULT_CONFIG } from '@/lib/oci/oci-config';

test('parseOciConfig: returns default config when input is null', () => {
    const result = parseOciConfig(null);
    assert.deepEqual(result, OCI_DEFAULT_CONFIG);
});

test('parseOciConfig: merges partial config correctly', () => {
    const partial = {
        base_value: 1000,
        currency: 'EUR',
    };
    const result = parseOciConfig(partial);
    assert.equal(result.base_value, 1000);
    assert.equal(result.currency, 'EUR');
});

test('parseOciConfig: ignores unknown legacy fields (min_star, weights)', () => {
    const partial = { base_value: 750, min_star: 4, weights: { 3: 0.5, 4: 0.8 } };
    const result = parseOciConfig(partial);
    assert.equal(result.base_value, 750);
    assert.ok(!('min_star' in result), 'min_star must not exist on result');
    assert.ok(!('weights' in result), 'weights must not exist on result');
});

test('computeConversionValue: returns major-unit value when saleAmount provided', () => {
    const value = computeConversionValue(500);
    assert.equal(typeof value, 'number');
    assert.ok(value !== null && value > 0, 'positive saleAmount must produce positive value');
});

test('computeConversionValue: null sale → canonical fallback', () => {
    assert.equal(computeConversionValue(null), 1000, 'V5: no sale now resolves to fallback');
});

test('computeConversionValue: zero sale → canonical fallback', () => {
    assert.equal(computeConversionValue(0), 1000);
});

test('computeConversionValue: custom fallbackMajor is honored', () => {
    assert.equal(computeConversionValue(null, { fallbackMajor: 750 }), 750);
});

test('computeConversionValue: negative sale → canonical fallback', () => {
    assert.equal(computeConversionValue(-100), 1000);
});
