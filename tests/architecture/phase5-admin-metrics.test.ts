/**
 * Phase 5 — `/api/admin/metrics` + Sentry tagging architecture pins.
 *
 * Invariants:
 *   1) The route file exists, uses `requireAdmin`, and delegates to the
 *      shared `buildAdminMetricsSnapshot` helper (no inline counting).
 *   2) The snapshot shape covers the launch checklist: dispatch PENDING,
 *      success rate, DLQ depth. If a key is renamed, external probes break —
 *      we pin the key list here.
 *   3) Sentry is wired: the route calls setTag with the metric keys.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

test('admin metrics route exists and is admin-guarded', () => {
  const path = join(ROOT, 'app/api/admin/metrics/route.ts');
  assert.ok(existsSync(path), 'admin metrics route must exist');
  const src = readFileSync(path, 'utf8');
  assert.match(
    src,
    /from ['"]@\/lib\/auth\/require-admin['"]/,
    'route must import requireAdmin'
  );
  assert.match(
    src,
    /await\s+requireAdmin\s*\(\s*\)/,
    'route must await requireAdmin() before any work'
  );
  assert.match(
    src,
    /from ['"]@\/lib\/admin\/metrics['"]/,
    'route must delegate to the shared metrics helper'
  );
  assert.match(
    src,
    /buildAdminMetricsSnapshot\s*\(/,
    'route must call buildAdminMetricsSnapshot'
  );
});

test('admin metrics route wires Sentry tags and context', () => {
  const src = readFileSync(join(ROOT, 'app/api/admin/metrics/route.ts'), 'utf8');
  assert.match(src, /Sentry\.setTag\(\s*'route'/, 'route tag missing');
  assert.match(src, /snapshotToSentryTags\(/, 'flattened metric tags must be set');
  assert.match(src, /Sentry\.setContext\(\s*'admin_metrics'/, 'admin_metrics context missing');
  assert.match(
    src,
    /Sentry\.captureException/,
    '5xx path must forward the error to Sentry'
  );
});

test('AdminMetricsSnapshot shape covers the launch checklist keys', () => {
  const src = readFileSync(join(ROOT, 'lib/admin/metrics.ts'), 'utf8');
  // Contract fields consumed by uptime probes / the ops dashboard.
  const requiredKeys = [
    // top-level
    'timestamp',
    // outbox
    'outbox',
    'pending',
    'processed_last_24h',
    // queue
    'queue',
    'queued',
    'completed_last_24h',
    'dead_letter_depth',
    // signals
    'signals',
    // dlq
    'sync_dlq_depth',
    // success rate
    'success_rate_last_24h',
  ];
  for (const key of requiredKeys) {
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(src),
      `metrics snapshot missing required key: ${key}`
    );
  }
});

test('buildAdminMetricsSnapshot queries the expected tables', () => {
  const src = readFileSync(join(ROOT, 'lib/admin/metrics.ts'), 'utf8');
  for (const table of [
    'outbox_events',
    'offline_conversion_queue',
    'marketing_signals',
    'sync_dlq',
  ]) {
    assert.ok(
      src.includes(`'${table}'`),
      `metrics helper must query ${table}`
    );
  }
});

test('snapshotToSentryTags exposes only string values (Sentry contract)', () => {
  const src = readFileSync(join(ROOT, 'lib/admin/metrics.ts'), 'utf8');
  assert.match(
    src,
    /export function snapshotToSentryTags/,
    'snapshotToSentryTags must be exported for the route'
  );
  // Every assignment must coerce to string — String(...) is the SSOT.
  const tagLines = src
    .split(/\r?\n/)
    .filter((l) => l.includes("'metrics.") && l.includes(':'));
  assert.ok(tagLines.length > 0, 'no metrics.* tag assignments found');
  for (const line of tagLines) {
    assert.ok(
      line.includes('String('),
      `tag line is not String()-wrapped (Sentry requires string values): ${line.trim()}`
    );
  }
});
