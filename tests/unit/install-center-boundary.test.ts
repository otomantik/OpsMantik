import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const INSTALL_DIR = join(ROOT, 'components/ops-center/install');

const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: 'recharts', pattern: /from\s+['"]recharts['"]/ },
  { label: 'useFunnelAnalytics', pattern: /useFunnelAnalytics/ },
  { label: 'CROInsights', pattern: /CROInsights/ },
  { label: 'google-spend', pattern: /google-spend/ },
  { label: 'conversations API', pattern: /\/api\/conversations/ },
  { label: '/api/stats/', pattern: /\/api\/stats\// },
  { label: 'reporting/dashboard-stats', pattern: /reporting\/dashboard-stats/ },
  { label: 'lib/ingest', pattern: /lib\/ingest/ },
  { label: 'lib/oci', pattern: /lib\/oci/ },
  { label: 'google-ads-export', pattern: /google-ads-export/ },
  { label: '/api/intents/', pattern: /\/api\/intents\// },
  { label: '/api/calls/', pattern: /\/api\/calls\// },
];

const files = readdirSync(INSTALL_DIR).filter((f) => f.endsWith('.tsx'));

for (const file of files) {
  test(`install-center-boundary: ${file}`, () => {
    const src = readFileSync(join(INSTALL_DIR, file), 'utf8');
    for (const { label, pattern } of FORBIDDEN) {
      assert.ok(!pattern.test(src), `${file} must not reference ${label}`);
    }
  });
}

test('install-center-boundary: tracker snippet uses proxy mode only', () => {
  const src = readFileSync(join(INSTALL_DIR, 'tracker-snippet-card.tsx'), 'utf8');
  assert.ok(src.includes('mode=proxy'), 'must request proxy embed');
  assert.ok(src.includes('data-ops-secret'), 'must reject secret-bearing tags');
});
