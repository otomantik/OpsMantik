/**
 * CUT-02D: every unscheduled cron handler documents break-glass deprecation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const SCHEDULED = new Set([
  '/api/cron/oci/process-outbox-events',
  '/api/cron/oci-maintenance',
  '/api/cron/night-maintenance',
  '/api/cron/auto-junk',
  '/api/cron/watchtower',
  '/api/cron/reconcile-usage',
  '/api/cron/invoice-freeze',
]);

function listCronRouteFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listCronRouteFiles(p, base));
    else if (name === 'route.ts') {
      const rel = p.slice(base.length + 1).replaceAll('\\', '/');
      out.push(join('app', 'api', 'cron', rel));
    }
  }
  return out;
}

function apiPathFromRel(rel: string): string {
  return '/api/cron/' + rel.replace(/^app[\\/]api[\\/]cron[\\/]/, '').replace(/[\\/]route\.ts$/, '').replaceAll('\\', '/');
}

test('CUT-02D: unscheduled cron routes carry @deprecated break-glass header', () => {
  const cronRoot = join(ROOT, 'app', 'api', 'cron');
  const files = listCronRouteFiles(cronRoot, cronRoot);
  const missing: string[] = [];

  for (const rel of files) {
    const apiPath = apiPathFromRel(rel);
    if (SCHEDULED.has(apiPath)) continue;
    const src = readFileSync(join(ROOT, rel), 'utf8');
    if (!src.includes('@deprecated')) missing.push(rel);
  }

  assert.equal(
    missing.length,
    0,
    `unscheduled cron routes must include @deprecated (CUT-02D):\n${missing.join('\n')}`
  );
});

test('CUT-02D: CRON_CONTRACT documents break-glass invocation', () => {
  const src = readFileSync(join(ROOT, 'docs', 'architecture', 'SEAL', 'CRON_CONTRACT.md'), 'utf8');
  assert.ok(src.includes('## Break-glass manual invocation'), 'appendix required');
  assert.ok(src.includes('CRON_SECRET'), 'must document auth');
  assert.ok(src.includes('OPSMANTIK_STORAGE_CLEANUP_APPROVAL'), 'must document storage approval');
});
