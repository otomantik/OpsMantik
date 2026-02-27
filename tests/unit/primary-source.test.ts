/**
 * Primary source (attribution) logic: precedence Call > Session, tenant-safe, best-effort.
 * Unit tests for getPrimarySource behaviour; DB-dependent paths require integration test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPrimarySource } from '../../lib/conversation/primary-source';

test('getPrimarySource with empty input returns null', async () => {
  const result = await getPrimarySource('00000000-0000-0000-0000-000000000001', {});
  assert.equal(result, null);
});

test('getPrimarySource with only sessionId (no callId) uses session path', async () => {
  const result = await getPrimarySource('00000000-0000-0000-0000-000000000001', {
    sessionId: '00000000-0000-0000-0000-000000000002',
  });
  assert.equal(result, null);
});

test('Precedence: callId branch is evaluated before sessionId in getPrimarySource', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'conversation', 'primary-source.ts'), 'utf8');
  const callBranchPos = src.indexOf('if (input.callId)');
  const sessionBranchPos = src.indexOf('if (input.sessionId)');
  assert.ok(callBranchPos !== -1 && sessionBranchPos !== -1, 'both branches exist');
  assert.ok(callBranchPos < sessionBranchPos, 'Call takes precedence over Session (call branch first)');
});

test('Primary source is always scoped by site_id (tenant-safe)', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'conversation', 'primary-source.ts'), 'utf8');
  const siteIdFilters = (src.match(/\.eq\s*\(\s*['"]site_id['"]\s*,\s*siteId\s*\)/g) ?? []).length;
  const rpcSiteId = (src.match(/p_site_id\s*:\s*siteId/g) ?? []).length;
  assert.ok(siteIdFilters >= 1 && rpcSiteId >= 1, 'calls path must scope by p_site_id, sessions path by .eq(site_id, siteId)');
});

test('Primary source returns null on error (best-effort)', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'conversation', 'primary-source.ts'), 'utf8');
  assert.ok(src.includes('} catch') && src.includes('return null'), 'catch returns null');
});
