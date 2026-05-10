import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const helperPath = join(process.cwd(), 'scripts', 'db', 'lib', 'resolve-site-identity.mjs');

test('resolve-site-identity.mjs: contract and safety', () => {
  const src = readFileSync(helperPath, 'utf8');

  assert.match(src, /export async function resolveSiteIdentity\b/, 'exports resolveSiteIdentity');
  assert.match(src, /\.eq\(['"]public_id['"]/, 'queries by public_id');
  assert.match(src, /\.eq\(['"]id['"]/, 'queries by sites.id when UUID-shaped');
  assert.match(src, /SITE_IDENTITY_AMBIGUOUS|multiple sites matched/i, 'ambiguous match fails loudly');
  assert.match(src, /found:\s*false|found:\s*true/, 'returns found flag');
  assert.match(src, /siteUuid/, 'returns siteUuid');
  assert.match(src, /publicId|public_id/, 'returns public id field');
  assert.match(
    src,
    /Never pass raw operator input directly to `offline_conversion_queue.site_id`|never pass raw operator input/i,
    'documents queue FK rule in header'
  );
  assert.match(src, /SITE_NOT_FOUND_HINT|offline_conversion_queue\.site_id stores sites\.id/i, 'hint mentions FK vs public_id');
  assert.doesNotMatch(
    src,
    /\.from\(['"]offline_conversion_queue['"]\)/,
    'resolver must not touch offline_conversion_queue (sites table only)'
  );
  assert.doesNotMatch(
    src,
    /\.(insert|update|upsert|delete)\(/i,
    'resolver must not mutate database'
  );
  assert.doesNotMatch(src, /gclid|wbraid|gbraid/i, 'resolver must not reference raw click id columns');
});
