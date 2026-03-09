import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capabilitiesForRole, hasCapability, type SiteRole } from '@/lib/auth/rbac';

test('RBAC v2: owner has all capabilities', () => {
  const caps = capabilitiesForRole('owner');
  assert.equal(caps.has('members:manage'), true);
  assert.equal(caps.has('site:write'), true);
  assert.equal(caps.has('queue:operate'), true);
  assert.equal(caps.has('billing:view'), true);
});

test('RBAC v2: admin has members + site write + queue operate', () => {
  assert.equal(hasCapability('admin', 'members:manage'), true);
  assert.equal(hasCapability('admin', 'site:write'), true);
  assert.equal(hasCapability('admin', 'queue:operate'), true);
});

test('RBAC v2: operator can operate queue only', () => {
  assert.equal(hasCapability('operator', 'queue:operate'), true);
  assert.equal(hasCapability('operator', 'members:manage'), false);
  assert.equal(hasCapability('operator', 'site:write'), false);
  assert.equal(hasCapability('operator', 'billing:view'), false);
});

test('RBAC v2: analyst is read-only', () => {
  const role: SiteRole = 'analyst';
  assert.equal(hasCapability(role, 'queue:operate'), false);
  assert.equal(hasCapability(role, 'members:manage'), false);
  assert.equal(hasCapability(role, 'site:write'), false);
});

test('RBAC v2: billing can only view billing', () => {
  assert.equal(hasCapability('billing', 'billing:view'), true);
  assert.equal(hasCapability('billing', 'queue:operate'), false);
});

test('RBAC v2: invite defaults to operator and OCI control mutators require queue capability', () => {
  const inviteSrc = readFileSync(join(process.cwd(), 'app', 'api', 'customers', 'invite', 'route.ts'), 'utf8');
  const authSrc = readFileSync(join(process.cwd(), 'lib', 'oci', 'control-auth.ts'), 'utf8');
  const actionsSrc = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'queue-actions', 'route.ts'), 'utf8');
  assert.ok(inviteSrc.includes("role = 'operator'"), 'invite route must default operational users to operator');
  assert.ok(authSrc.includes('requiredCapability?: Capability'), 'OCI control auth must support explicit capability checks');
  assert.ok(actionsSrc.includes("requireOciControlAuth(parsed.data.siteId, 'queue:operate')"), 'OCI mutators must require queue:operate');
});
