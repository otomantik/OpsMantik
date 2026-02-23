import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyIngestBillable } from '@/lib/billing/ingest-billable';

import type { ValidIngestPayload } from '@/lib/types/ingest';

const minimalPayload = (overrides: Partial<ValidIngestPayload>): ValidIngestPayload =>
  ({ s: 'site', u: 'https://x', ec: 'interaction', ea: 'view', ...overrides } as ValidIngestPayload);

test('classifyIngestBillable: conversion is billable', () => {
  const d = classifyIngestBillable(minimalPayload({ ec: 'conversion', ea: 'phone_call' }));
  assert.equal(d.billable, true);
});

test('classifyIngestBillable: interaction/view is billable', () => {
  const d = classifyIngestBillable(minimalPayload({ ec: 'interaction', ea: 'view' }));
  assert.equal(d.billable, true);
  assert.equal(d.reason, 'interaction_view');
});

test('classifyIngestBillable: interaction/scroll_depth is non-billable', () => {
  const d = classifyIngestBillable(minimalPayload({ ec: 'interaction', ea: 'scroll_depth' }));
  assert.equal(d.billable, false);
  assert.equal(d.reason, 'scroll_depth');
});

test('classifyIngestBillable: system/* is non-billable', () => {
  const d = classifyIngestBillable(minimalPayload({ ec: 'system', ea: 'heartbeat' }));
  assert.equal(d.billable, false);
  assert.equal(d.reason, 'system');
});

