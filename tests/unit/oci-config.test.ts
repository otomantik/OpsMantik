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

test('computeConversionValue: skips if star is below min_star', () => {
    const config = parseOciConfig({ min_star: 4 });
    const value = computeConversionValue(3, null, config);
    assert.equal(value, null);
});

test('computeConversionValue: applies weights correctly', () => {
    const config = parseOciConfig({
        base_value: 1000,
        weights: { 3: 0.5, 4: 0.8, 5: 1.0 }
    });

    assert.equal(computeConversionValue(3, null, config), 500);
    assert.equal(computeConversionValue(4, null, config), 800);
    assert.equal(computeConversionValue(5, null, config), 1000);
});

test('computeConversionValue: fallback if star not in weights', () => {
    const config = parseOciConfig({
        base_value: 1000,
        weights: { 5: 1.0 }
    });
    // If star=4 is not in weights, it should fallback to 1.0 weight (implicit behavior)
    // or whatever computeConversionValue does. Let's check code.
    // result = config.base_value * (config.weights[s] ?? 1.0)
    assert.equal(computeConversionValue(4, null, config), 1000);
});
