import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('core spine: intent RPC migration exposes calls.version in lite payload', () => {
  const src = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20260420120000_intent_rpcs_calls_version.sql'),
    'utf8'
  );
  assert.ok(src.includes("'version', COALESCE(c.version, 0)"), 'lite queue json must include version');
});

test('core spine: vercel does not schedule standalone process-offline-conversions', () => {
  const vercel = readFileSync(join(ROOT, 'vercel.json'), 'utf8');
  assert.ok(
    !vercel.includes('/api/cron/process-offline-conversions'),
    'upload batch must run via oci-maintenance chain, not a second scheduler'
  );
  assert.ok(vercel.includes('/api/cron/oci-maintenance'), 'oci-maintenance must remain scheduled');
});

test('core spine: oci-maintenance chains runOfflineConversionRunner after sweeps', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'cron', 'oci-maintenance', 'route.ts'), 'utf8');
  assert.ok(src.includes('runOfflineConversionRunner'), 'maintenance cron must invoke OCI upload runner');
});

test('core spine: plan docs exist (idempotency, threat, tier-0)', () => {
  for (const rel of [
    'docs/architecture/IDEMPOTENCY_CONTRACT.md',
    'docs/architecture/OCI_THREAT_MODEL.md',
    'docs/architecture/MVP_TIER0_ROUTES.md',
  ]) {
    const p = join(ROOT, rel);
    const s = readFileSync(p, 'utf8');
    assert.ok(s.length > 80, `${rel} must be non-trivial`);
  }
});

test('core spine: conversion_dispatch stub migration present', () => {
  const src = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20260420140000_conversion_dispatch_stub.sql'),
    'utf8'
  );
  assert.ok(src.includes('CREATE TABLE IF NOT EXISTS public.conversion_dispatch'), 'stub table migration');
});

test('core spine: panel sends calls.version on seal when known', () => {
  const src = readFileSync(join(ROOT, 'lib', 'hooks', 'use-queue-controller.ts'), 'utf8');
  assert.ok(src.includes('intentForSeal.version'), 'seal body must use intent version from RPC');
});

test('core spine: stage route passes optimistic version to apply_call_action_v2', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'intents', '[id]', 'stage', 'route.ts'), 'utf8');
  assert.ok(src.includes('p_version: effectiveVersionForRpc'), 'stage RPC must receive resolved version');
  assert.ok(src.includes('apply_call_action_v2'), 'stage RPC must be v2');
});
