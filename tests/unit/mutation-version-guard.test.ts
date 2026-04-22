import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveMutationVersion } from '@/lib/integrity/mutation-version';

function resetEnv(): Record<string, string | undefined> {
  const keys = [
    'STRICT_MUTATION_VERSION_ENFORCE',
    'COMPAT_VERSION_BYPASS_UNTIL',
    'COMPAT_VERSION_BYPASS_TENANT_ALLOWLIST',
    'COMPAT_VERSION_BYPASS_START_RELEASE',
    'OPSMANTIK_RELEASE_NUMBER',
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  return prev;
}

function restoreEnv(prev: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test('resolveMutationVersion rejects missing when strict on', () => {
  const prev = resetEnv();
  try {
    process.env.STRICT_MUTATION_VERSION_ENFORCE = 'true';
    const out = resolveMutationVersion({
      rawVersion: null,
      route: '/test',
      siteId: 'site-a',
      requestHeaders: new Headers(),
      fallbackVersion: 11,
    });
    assert.equal(out.ok, false);
  } finally {
    restoreEnv(prev);
  }
});

test('resolveMutationVersion allows compat bypass for allowlisted tenant', () => {
  const prev = resetEnv();
  try {
    process.env.STRICT_MUTATION_VERSION_ENFORCE = 'true';
    process.env.COMPAT_VERSION_BYPASS_UNTIL = new Date(Date.now() + 60_000).toISOString();
    process.env.COMPAT_VERSION_BYPASS_TENANT_ALLOWLIST = 'site-a,site-b';
    process.env.COMPAT_VERSION_BYPASS_START_RELEASE = '10';
    process.env.OPSMANTIK_RELEASE_NUMBER = '11';
    const headers = new Headers({ 'x-ops-compat-version-bypass': '1' });
    const out = resolveMutationVersion({
      rawVersion: 0,
      route: '/test',
      siteId: 'site-a',
      requestHeaders: headers,
      fallbackVersion: 9,
    });
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.version, 9);
  } finally {
    restoreEnv(prev);
  }
});
