import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ROUTE = join(ROOT, 'app/panel/sites/[siteId]/install/page.tsx');

test('install-center-route: page exists', () => {
  assert.ok(existsSync(ROUTE), 'install page route must exist');
});

test('install-center-route: auth and site access', () => {
  const src = readFileSync(ROUTE, 'utf8');
  assert.ok(src.includes('getUser'), 'must require authenticated user');
  assert.ok(src.includes('validateSiteAccess'), 'must validate site access');
  assert.ok(src.includes("redirect('/login')"), 'must redirect unauthenticated users');
  assert.ok(src.includes('notFound'), 'must 404 forbidden sites');
});

test('install-center-route: loads read-only install snapshot', () => {
  const src = readFileSync(ROUTE, 'utf8');
  assert.ok(src.includes('loadInstallSiteSnapshot'), 'must load install snapshot');
  assert.ok(src.includes('InstallCenter'), 'must render InstallCenter');
  assert.ok(!src.includes('google-ads-export'), 'must not touch OCI export routes');
});
