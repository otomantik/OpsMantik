import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyIngestBillable } from '@/lib/billing/ingest-billable';

test('classifyIngestBillable: conversion is billable', () => {
  const d = classifyIngestBillable({ s: 'site', u: 'https://x', ec: 'conversion', ea: 'phone_call' } as any);
  assert.equal(d.billable, true);
});

test('classifyIngestBillable: interaction/view is billable', () => {
  const d = classifyIngestBillable({ s: 'site', u: 'https://x', ec: 'interaction', ea: 'view' } as any);
  assert.equal(d.billable, true);
  assert.equal(d.reason, 'interaction_view');
});

test('classifyIngestBillable: interaction/scroll_depth is non-billable', () => {
  const d = classifyIngestBillable({ s: 'site', u: 'https://x', ec: 'interaction', ea: 'scroll_depth' } as any);
  assert.equal(d.billable, false);
  assert.equal(d.reason, 'scroll_depth');
});

test('classifyIngestBillable: system/* is non-billable', () => {
  const d = classifyIngestBillable({ s: 'site', u: 'https://x', ec: 'system', ea: 'heartbeat' } as any);
  assert.equal(d.billable, false);
  assert.equal(d.reason, 'system');
});

