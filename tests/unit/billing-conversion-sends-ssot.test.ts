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
    doc.includes('provider') || doc.includes('Google'),
    'doc must clarify conversion_sends is not provider-import proof'
  );
  const types = readFileSync(TYPES, 'utf8');
  assert.ok(types.includes('BILLING_CONVERSION_SENDS_SSOT.md'), 'types.ts must point to SSOT doc');
});

test('PR-F: increment_usage_checked supports conversion_sends kind in schema contract', () => {
  const schema = readFileSync(join(process.cwd(), 'schema_utf8.sql'), 'utf8');
  const idx = schema.indexOf('CREATE OR REPLACE FUNCTION "public"."increment_usage_checked"');
  assert.ok(idx >= 0);
  const slice = schema.slice(idx, idx + 1200);
  assert.ok(slice.includes("'conversion_sends'"), 'increment_usage_checked must allow conversion_sends kind');
  assert.ok(slice.includes('conversion_sends_count'), 'increment must touch conversion_sends_count column');
});
