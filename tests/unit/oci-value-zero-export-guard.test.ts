/**
 * PR-OCI-4 (P0): 0 TL / NaN / NULL value_cents must never reach Google export output.
 * Source-inspection tests (fast, stable, DB-free).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPORT_ROUTE = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');

test('PR-OCI-4: export must not coerce value_cents with `Number(x) || 0`', () => {
  const src = readFileSync(EXPORT_ROUTE, 'utf-8');
  assert.equal(
    src.includes('Number(row.value_cents) || 0'),
    false,
    'Export must not treat null/NaN as 0 via `|| 0`'
  );
});

test('PR-OCI-4: export must skip non-finite or <=0 valueCents (defense-in-depth)', () => {
  const src = readFileSync(EXPORT_ROUTE, 'utf-8');

  const hasFiniteGuard = src.includes('Number.isFinite(valueCents)') || src.includes('!Number.isFinite(valueCents)');
  assert.ok(hasFiniteGuard, 'Expected Number.isFinite guard on valueCents');

  assert.ok(
    /valueCents\s*<=\s*0/.test(src),
    'Expected a guard that blocks valueCents <= 0'
  );

  assert.ok(
    src.includes('continue;'),
    'Expected skip path to continue (do not include conversion in response)'
  );
});

test('PR-OCI-4: export should log a marker for skipped zero-value rows', () => {
  const src = readFileSync(EXPORT_ROUTE, 'utf-8');
  assert.ok(
    src.includes('OCI_EXPORT_SKIP_VALUE_ZERO') || src.includes('VALUE_ZERO'),
    'Expected a log marker/tag for skipped value-zero rows'
  );
});

test('PR-OCI-9A: export Pipeline B (signals) must skip null or non-positive conversion_value', () => {
  const src = readFileSync(EXPORT_ROUTE, 'utf-8');
  assert.ok(
    src.includes('NULL_CONVERSION_VALUE') || src.includes('NON_POSITIVE_CONVERSION_VALUE'),
    'Expected explicit skip reason for signal conversion_value'
  );
  assert.ok(
    src.includes('OCI_EXPORT_SIGNAL_SKIP_VALUE'),
    'Expected log marker for skipped signal value rows'
  );
});

test('PR-OCI-4: export (markAsExported) should terminalize blocked rows as FAILED/VALUE_ZERO', () => {
  const src = readFileSync(EXPORT_ROUTE, 'utf-8');
  assert.ok(src.includes("status: 'FAILED'") || src.includes('status: "FAILED"'), 'Expected status FAILED update for blocked rows');
  assert.ok(src.includes("last_error: 'VALUE_ZERO'") || src.includes('last_error: "VALUE_ZERO"'), 'Expected last_error VALUE_ZERO for blocked rows');
});
