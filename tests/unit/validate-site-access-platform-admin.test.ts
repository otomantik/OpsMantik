import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('validateSiteAccess resolves platform admin with metadata fallback', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'security', 'validate-site-access.ts'), 'utf8');
  assert.ok(src.includes('supabase.auth.getUser()'), 'validateSiteAccess must load auth user for metadata fallback');
  assert.ok(
    src.includes('resolvePlatformAdmin(profile?.role ?? null, authUser ?? null)'),
    'platform admin resolution must include auth user metadata fallback'
  );
});
