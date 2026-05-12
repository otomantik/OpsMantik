import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOC = join(process.cwd(), 'docs', 'architecture', 'BILLING_CONVERSION_SENDS_SSOT.md');
const TYPES = join(process.cwd(), 'lib', 'entitlements', 'types.ts');

test('PR-F: conversion_sends SSOT doc exists and types module references the contract', () => {
  const doc = readFileSync(DOC, 'utf8');
  assert.ok(
    doc.includes('conversion_sends') && doc.includes('SSOT'),
    'billing SSOT doc must name conversion_sends and SSOT'
  );
  assert.ok(
    doc.includes('export-mark-processing') &&
      doc.includes('incrementConversionSendsForExportClaim') &&
      doc.includes('increment_oci_conversion_sends_v1') &&
      doc.includes('oci_conversion_send_billing_ledger'),
    'SSOT must document the OCI export billing hook, ledger, and RPC'
  );
  assert.ok(
    doc.includes('provider') || doc.includes('Google'),
    'doc must clarify conversion_sends is not provider-import proof'
  );
  const types = readFileSync(TYPES, 'utf8');
  assert.ok(types.includes('BILLING_CONVERSION_SENDS_SSOT.md'), 'types.ts must point to SSOT doc');
});

test('PR-F: OCI export mark-processing wires conversion_sends increment before claim', () => {
  const src = readFileSync(
    join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'),
    'utf8'
  );
  assert.ok(src.includes("incrementConversionSendsForExportClaim"), 'export flow must call conversion_sends increment helper');
  assert.ok(src.includes('append_script_claim_transition_batch'), 'export flow must still claim via RPC');
  const incIdx = src.indexOf('incrementConversionSendsForExportClaim');
  const claimIdx = src.indexOf('append_script_claim_transition_batch');
  assert.ok(incIdx >= 0 && claimIdx >= 0 && incIdx < claimIdx, 'increment must run before append_script_claim_transition_batch');
  assert.ok(
    /incrementConversionSendsForExportClaim\s*\(\s*ctx\.siteUuid\s*,\s*idsToMarkProcessing\s*\)/.test(src),
    'increment must receive the same queue id batch as claim'
  );
});

test('PR-F: OCI billing helper calls increment_oci_conversion_sends_v1 (not Node-side counter math)', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'billing', 'increment-conversion-sends-export.ts'), 'utf8');
  assert.ok(src.includes("'increment_oci_conversion_sends_v1'"), 'must use idempotent ledger RPC');
  assert.ok(src.includes('ociConversionSendBillingQueueIdsSchema'), 'must validate queue ids with Zod');
  assert.ok(!src.includes("'increment_usage_checked'"), 'OCI export must not use increment_usage_checked');
});
