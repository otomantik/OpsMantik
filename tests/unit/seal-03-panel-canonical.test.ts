/**
 * SEAL-03: /panel canonical operator cockpit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLandingRoute } from '@/lib/auth/landing-route';
import { panelOciPath, panelSitePath } from '@/lib/auth/site-operational-route';

const ROOT = process.cwd();

test('SEAL-03: operators land on /panel after login', () => {
  assert.equal(resolveLandingRoute({ isAdmin: false, siteCount: 1 }), '/panel');
  assert.equal(resolveLandingRoute({ isAdmin: true, siteCount: 3 }), '/dashboard');
});

test('SEAL-03: panel page mounts OCI + install strips', () => {
  const src = readFileSync(join(ROOT, 'app', 'panel', 'page.tsx'), 'utf8');
  assert.ok(src.includes('OciStatusStrip'), 'panel must show OCI status strip');
  assert.ok(src.includes('InstallHealthStrip'), 'panel must show install health strip');
});

test('SEAL-03: legacy oci-control redirects to panel OCI', () => {
  const src = readFileSync(join(ROOT, 'app', 'dashboard', 'site', '[siteId]', 'oci-control', 'page.tsx'), 'utf8');
  assert.ok(src.includes('panelOciPath'), 'dashboard oci-control must redirect to panel');
});

test('SEAL-03: panel OCI route exists', () => {
  const src = readFileSync(join(ROOT, 'app', 'panel', 'oci', 'page.tsx'), 'utf8');
  assert.ok(src.includes('OciControlPanel'), 'panel oci page hosts control panel');
  assert.ok(src.includes('PanelChrome'), 'panel oci uses shared chrome');
});

test('SEAL-03: panel path helpers', () => {
  assert.equal(panelSitePath('abc'), '/panel?siteId=abc');
  assert.equal(panelOciPath('abc'), '/panel/oci?siteId=abc');
});
