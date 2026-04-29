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
  assert.ok(
    inviteSrc.includes(": 'operator'"),
    'invite route must default operational users to operator'
  );
  assert.ok(authSrc.includes('requiredCapability?: Capability'), 'OCI control auth must support explicit capability checks');
  assert.ok(actionsSrc.includes("requireOciControlAuth(parsed.data.siteId, 'queue:operate')"), 'OCI mutators must require queue:operate');
});

test('RBAC v2: operator queue flows return explicit read-only semantics', () => {
  const sealSrc = readFileSync(join(process.cwd(), 'app', 'api', 'calls', '[id]', 'seal', 'route.ts'), 'utf8');
  const salesReviewSrc = readFileSync(join(process.cwd(), 'app', 'api', 'sales', '[id]', 'review', 'route.ts'), 'utf8');
  const queueDeckSrc = readFileSync(join(process.cwd(), 'components', 'dashboard', 'qualification-queue', 'queue-deck.tsx'), 'utf8');
  const queueControllerSrc = readFileSync(join(process.cwd(), 'lib', 'hooks', 'use-queue-controller.ts'), 'utf8');
  assert.ok(sealSrc.includes("code: 'READ_ONLY_SCOPE'"), 'seal route must emit READ_ONLY_SCOPE code on permission deny');
  assert.ok(sealSrc.includes("{ status: 403 }"), 'seal route deny path must return 403');
  assert.ok(salesReviewSrc.includes("hasCapability(access.role, 'queue:operate')"), 'sales review route must align with queue:operate');
  assert.ok(queueDeckSrc.includes('Mudahale yetkiniz yok (salt okunur).'), 'queue deck must show visible toast on readOnly attempts');
  assert.ok(queueControllerSrc.includes("throw new Error('Islem yapilacak kayit bulunamadi.')"), 'seal confirm must throw explicit missing-intent error');
});
