/**
 * Panel v1 bundle boundary — no out-of-core analytics/CRO/spend/conversations imports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const PANEL_FILES = [
  'app/panel/page.tsx',
  'components/dashboard/panel-feed.tsx',
  'components/dashboard/hunter-card.tsx',
  'components/dashboard/lead-action-overlay.tsx',
] as const;

const FORBIDDEN_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'recharts', pattern: /from\s+['"]recharts['"]/ },
  { label: 'useFunnelAnalytics', pattern: /useFunnelAnalytics/ },
  { label: 'CROInsights', pattern: /CROInsights/ },
  { label: 'google-spend', pattern: /google-spend/ },
  { label: 'dashboard/spend', pattern: /dashboard\/spend/ },
  { label: 'conversations API', pattern: /\/api\/conversations/ },
  { label: 'reporting/dashboard-stats', pattern: /reporting\/dashboard-stats/ },
  { label: '/api/stats/', pattern: /\/api\/stats\// },
  { label: 'TrafficSourceBreakdown', pattern: /TrafficSourceBreakdown/ },
  { label: 'PulseProjectionWidgets', pattern: /PulseProjectionWidgets/ },
  { label: 'BreakdownWidgets', pattern: /BreakdownWidgets/ },
];

for (const rel of PANEL_FILES) {
  test(`panel boundary: ${rel} has no out-of-core imports`, () => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    for (const { label, pattern } of FORBIDDEN_PATTERNS) {
      assert.ok(!pattern.test(src), `${rel} must not reference ${label}`);
    }
  });
}
