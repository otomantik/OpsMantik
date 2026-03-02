/**
 * Unit tests for OCI Config logic.
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
        min_star: 4
    };
    const result = parseOciConfig(partial);
    assert.equal(result.base_value, 1000);
    assert.equal(result.min_star, 4);
    assert.equal(result.currency, 'TRY'); // fallback
    assert.deepEqual(result.weights, OCI_DEFAULT_CONFIG.weights); // fallback
});

test('computeConversionValue: uses actual revenue if provided', () => {
    const config = parseOciConfig(null);
    const value = computeConversionValue(2, 500, config);
    assert.equal(value, 500);
});

test('computeConversionValue: no sale (null) returns null — 0 TL mühür olmaz (PR-OCI-1)', () => {
    const config = parseOciConfig({ min_star: 4 });
    const value = computeConversionValue(3, null, config);
    assert.equal(value, null, 'V5: no sale → null, caller must NOT enqueue');
});

test('computeConversionValue: no sale (0) returns null', () => {
    const config = parseOciConfig({ min_star: 4 });
    assert.equal(computeConversionValue(3, 0, config), null);
});

test('computeConversionValue: no sale returns null (V5 bypasses weights proxy)', () => {
    const config = parseOciConfig({
        base_value: 1000,
        weights: { 3: 0.5, 4: 0.8, 5: 1.0 }
    });
    assert.equal(computeConversionValue(3, null, config), null);
    assert.equal(computeConversionValue(4, null, config), null);
    assert.equal(computeConversionValue(5, null, config), null);
});

test('computeConversionValue: no sale returns null (star/weights not used)', () => {
    const config = parseOciConfig({
        base_value: 1000,
        weights: { 5: 1.0 }
    });
    assert.equal(computeConversionValue(4, null, config), null);
});
