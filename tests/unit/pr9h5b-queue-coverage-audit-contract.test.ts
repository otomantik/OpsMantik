import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const auditPath = join(process.cwd(), 'scripts', 'db', 'pr9h5b-queue-coverage-audit.mjs');

test('pr9h5b-queue-coverage-audit.mjs: uses resolver and never binds raw env to queue site_id', () => {
  const src = readFileSync(auditPath, 'utf8');

  assert.match(src, /resolveSiteIdentity/, 'imports / uses resolveSiteIdentity');
  assert.match(src, /from '\.\/lib\/resolve-site-identity\.mjs'/, 'loads shared resolver');
  assert.match(src, /\.eq\(['"]site_id['"],\s*siteUuid\)/, 'queue queries use resolved siteUuid');
  assert.match(src, /resolved_site_uuid|resolved\.siteUuid/, 'report exposes resolved UUID');

  assert.doesNotMatch(
    src,
    /\.eq\(['"]site_id['"],\s*rawTarget\)/,
    'must not eq site_id to raw TARGET_SITE_ID string'
  );
  assert.doesNotMatch(
    src,
    /\.eq\(['"]site_id['"],\s*resolved\.input\)/,
    'must not eq site_id to operator input string'
  );
  assert.doesNotMatch(
    src,
    /\.eq\(['"]site_id['"],\s*process\.env\.TARGET_SITE_ID\)/,
    'must not eq site_id directly to process.env'
  );

  assert.match(src, /SITE_NOT_FOUND_HINT|SITE_NOT_FOUND/, 'failure path references site not found');
  assert.match(
    src,
    /public_id|sites\.id|internal UUID/i,
    'error or hint distinguishes public_id vs internal id'
  );

  assert.match(src, /Read-only|Does not mutate|no mutation/i, 'documents read-only intent');
  assert.doesNotMatch(
    src,
    /\.(insert|update|upsert|delete)\(/i,
    'audit script must not call mutating supabase methods'
  );

  assert.doesNotMatch(
    src,
    /console\.(log|error|info)\([^)]*\bgclid\b/i,
    'must not log raw gclid to console'
  );
  assert.match(
    src,
    /Does not print raw gclid|booleans only|aggregates only/i,
    'documents no raw click id output'
  );
});
