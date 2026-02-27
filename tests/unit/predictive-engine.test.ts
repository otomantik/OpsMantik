import { test } from 'node:test';
import assert from 'node:assert';
import { calculateExpectedValue, DEFAULT_AOV } from '../../lib/valuation/predictive-engine';

test('Predictive Engine: calculates default values correctly', () => {
    // Sealed should be 1.0 * DEFAULT_AOV
    const val = calculateExpectedValue(null, null, 'sealed');
    assert.strictEqual(val, DEFAULT_AOV * 1.0);

    // Qualified should be 0.2 * DEFAULT_AOV
    const val2 = calculateExpectedValue(null, null, 'qualified');
    assert.strictEqual(val2, DEFAULT_AOV * 0.2);
});

test('Predictive Engine: respects custom AOV', () => {
    const val = calculateExpectedValue(500, null, 'sealed');
    assert.strictEqual(val, 500);
});

test('Predictive Engine: respects custom weights', () => {
    const weights = { qualified: 0.5 };
    const val = calculateExpectedValue(100, weights, 'qualified');
    assert.strictEqual(val, 50);
});

test('Predictive Engine: handles unknown intent as 0', () => {
    const val = calculateExpectedValue(100, null, 'unknown');
    assert.strictEqual(val, 0);
});

test('Predictive Engine: case insensitivity', () => {
    const val = calculateExpectedValue(100, null, 'SEALED');
    assert.strictEqual(val, 100);
});
