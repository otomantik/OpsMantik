/**
 * Site operators must not land on Komuta Merkezi; platform admins keep command center.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

test('site command center redirects non-platform admins to panel', () => {
  const src = readFileSync(join(ROOT, 'app/dashboard/site/[siteId]/page.tsx'), 'utf8');
  assert.match(src, /panelSitePath/, 'uses panelSitePath helper');
  assert.match(src, /if \(!userIsAdmin\)[\s\S]*redirect\(panelSitePath/, 'redirects operators before shell');
});

test('site switcher sends operators to panel, admins to panel-preview', () => {
  const src = readFileSync(join(ROOT, 'components/dashboard/site-switcher.tsx'), 'utf8');
  assert.match(src, /panelSitePath\(siteId\)/, 'operator site select opens panel');
  assert.match(src, /panel-preview/, 'platform admin preview path preserved');
});
