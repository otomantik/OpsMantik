import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('verify route checks x-api-key against sites.oci_api_key and returns INVALID_CREDENTIALS', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'v2', 'verify', 'route.ts');
  const src = readFileSync(routePath, 'utf8');

  assert.ok(src.includes(".select('id, public_id, oci_api_key')"), 'verify route must fetch oci_api_key');
  assert.ok(src.includes('timingSafeCompare(site.oci_api_key, apiKey)'), 'verify route must use timing-safe compare');
  assert.ok(src.includes("code: 'INVALID_CREDENTIALS'"), 'verify route must return INVALID_CREDENTIALS');
});

test('export auth validates x-api-key against sites.oci_api_key', () => {
  const authPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-auth.ts');
  const ssotPath = join(process.cwd(), 'lib', 'oci', 'export', 'auth.ts');
  const src = readFileSync(authPath, 'utf8');
  const ssot = readFileSync(ssotPath, 'utf8');

  assert.ok(src.includes('oci_api_key'), 'export auth must read oci_api_key from sites');
  assert.ok(src.includes('verifySiteApiKey'), 'export auth must delegate to shared verifySiteApiKey');
  assert.ok(ssot.includes('timingSafeCompare'), 'export auth SSOT must use timing-safe compare');
  assert.ok(src.includes('Unauthorized: Invalid API key'), 'export auth must reject invalid API keys');
});
