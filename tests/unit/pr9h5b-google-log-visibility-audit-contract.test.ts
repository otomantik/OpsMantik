import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const auditPath = join(process.cwd(), 'scripts', 'db', 'pr9h5b-google-log-visibility-audit.mjs');

test('pr9h5b-google-log-visibility-audit.mjs: read-only + resolver + Google log semantics', () => {
  const src = readFileSync(auditPath, 'utf8');

  assert.match(src, /resolveSiteIdentity/, 'uses site identity resolver');
  assert.match(src, /\.eq\(['"]site_id['"],\s*siteUuid\)/, 'queue queries use resolved UUID');
  assert.doesNotMatch(
    src,
    /\.eq\(['"]site_id['"],\s*rawTarget\)/,
    'must not filter queue by raw env input'
  );

  assert.match(src, /upload\.apply|upload\.apply/i, 'documents Google upload path');
  assert.match(src, /Google Ads.*upload log|google_ads_upload_log/i, 'explains Google Ads upload log');
  assert.match(src, /PEEK|markAsExported=false|peek/i, 'mentions PEEK does not write Google log');
  assert.match(src, /QUEUED|queue_queued/i, 'mentions local QUEUED semantics');

  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/i, 'read-only: no mutations');

  assert.doesNotMatch(
    src,
    /console\.log\([^)]*gclid[^)]*\)/i,
    'must not print raw gclid in console payloads'
  );
});
