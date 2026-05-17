import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CONFIG = join(ROOT, 'lib', 'tracker', 'config.js');

/** Mirrors lib/tracker/config.js deriveSyncProxyUrl (contract). */
function deriveSyncProxyUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  return url.replace(/\/call-event(?:\/v2)?\/?(?=[?#]|$)/i, '/sync');
}

test('deriveSyncProxyUrl maps call-event and call-event/v2 to sibling /sync', () => {
  assert.equal(
    deriveSyncProxyUrl('https://console.example.com/api/call-event'),
    'https://console.example.com/api/sync'
  );
  assert.equal(
    deriveSyncProxyUrl('https://shop.com/opsmantik/call-event'),
    'https://shop.com/opsmantik/sync'
  );
  assert.equal(
    deriveSyncProxyUrl('https://console.example.com/api/call-event/v2'),
    'https://console.example.com/api/sync'
  );
  assert.equal(
    deriveSyncProxyUrl('https://console.example.com/api/call-event/v2?x=1'),
    'https://console.example.com/api/sync?x=1'
  );
});

test('tracker config source keeps derive + resolveIngestBaseOriginForCallEvent for call-event base', () => {
  const src = readFileSync(CONFIG, 'utf8');
  assert.match(src, /\/call-event\(\?:\\\/v2\)\?/);
  assert.ok(src.includes('resolveIngestBaseOriginForCallEvent'));
});
