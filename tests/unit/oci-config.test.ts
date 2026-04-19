/**
 * Unit tests for OCI Config logic.
 *
 * Site config is now reduced to global-safe defaults plus optional intelligence metadata.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOciConfig, OCI_DEFAULT_CONFIG } from '@/lib/oci/oci-config';

test('parseOciConfig: returns default config when input is null', () => {
    const result = parseOciConfig(null);
    assert.deepEqual(result, OCI_DEFAULT_CONFIG);
});

test('parseOciConfig: honors tenant-supplied currency override', () => {
    // Phase 1: parseExportConfig now uses Zod safeParse and honors valid
    // tenant-supplied currency / timezone overrides instead of silently
    // reverting to TRY. This is required for the global launch so non-TR
    // sites can self-configure their billing currency.
    const partial = {
        currency: 'EUR',
    };
    const result = parseOciConfig(partial);
    assert.equal(result.currency, 'EUR');
});

test('parseOciConfig: ignores unknown legacy fields (min_star, weights)', () => {
    const partial = { min_star: 4, weights: { 3: 0.5, 4: 0.8 } };
    const result = parseOciConfig(partial);
    assert.deepEqual(result.intelligence, OCI_DEFAULT_CONFIG.intelligence);
    assert.ok(!('min_star' in result), 'min_star must not exist on result');
    assert.ok(!('weights' in result), 'weights must not exist on result');
});
