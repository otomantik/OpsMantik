/**
 * Phase 4 guard — f4-runner-split.
 *
 * The OCI runner (lib/oci/runner.ts) and the Google Ads export route
 * (app/api/oci/google-ads-export/route.ts) used to be 1200+-line god objects
 * that combined orchestration, helpers, types, and error accounting in one
 * file. Phase 4 splits the stable, self-contained helpers into dedicated
 * submodules under lib/oci/runner/* and lib/oci/google-ads-export/*.
 *
 * Invariants pinned here:
 *   1) The expected submodules exist and export the expected symbols.
 *   2) The original files no longer define the extracted helpers locally —
 *      so we cannot drift back into "I'll just paste this here" territory.
 *   3) Both parent files stay under a sanity line budget. If you push them
 *      back over the threshold, stop and split before shipping.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// 1) Runner submodules exist and export the right symbols
// ---------------------------------------------------------------------------

const RUNNER_SUBMODULES: Array<{ path: string; exports: string[] }> = [
  { path: 'lib/oci/runner/credentials.ts', exports: ['decryptCredentials'] },
  { path: 'lib/oci/runner/dead-letter.ts', exports: ['writeQueueDeadLetterAudit'] },
  {
    path: 'lib/oci/runner/log-helpers.ts',
    exports: ['logRunnerError', 'logGroupOutcome', 'getQueueAttemptCount'],
  },
  { path: 'lib/oci/runner/provider-outcome.ts', exports: ['persistProviderOutcome'] },
  {
    path: 'lib/oci/runner/queue-bulk-update.ts',
    exports: ['bulkUpdateQueue', 'bulkUpdateQueueGrouped', 'buildWorkerBatchErrorPayload'],
  },
  { path: 'lib/oci/runner/queue-value-sync.ts', exports: ['syncQueueValuesFromCalls'] },
];

for (const { path, exports } of RUNNER_SUBMODULES) {
  test(`runner submodule exists and exports expected symbols: ${path}`, () => {
    const full = join(ROOT, path);
    assert.ok(existsSync(full), `missing submodule: ${path}`);
    const src = readFileSync(full, 'utf8');
    for (const sym of exports) {
      const pattern = new RegExp(`export (async )?function ${sym}\\b`);
      assert.ok(pattern.test(src), `${path} missing export function ${sym}`);
    }
  });
}

// ---------------------------------------------------------------------------
// 2) runner.ts no longer defines extracted helpers locally
// ---------------------------------------------------------------------------

test('lib/oci/runner.ts does not redefine extracted helpers locally', () => {
  const src = readFileSync(join(ROOT, 'lib/oci/runner.ts'), 'utf8');
  const bannedLocalDefs = [
    /^async function decryptCredentials\b/m,
    /^async function writeQueueDeadLetterAudit\b/m,
    /^function logRunnerError\b/m,
    /^function logGroupOutcome\b/m,
    /^function getQueueAttemptCount\b/m,
    /^async function persistProviderOutcome\b/m,
    /^async function bulkUpdateQueue\b/m,
    /^async function bulkUpdateQueueGrouped\b/m,
    /^function buildWorkerBatchErrorPayload\b/m,
    /^async function syncQueueValuesFromCalls\b/m,
  ];
  const violations: string[] = [];
  for (const re of bannedLocalDefs) {
    if (re.test(src)) violations.push(re.toString());
  }
  assert.equal(
    violations.length,
    0,
    `runner.ts should import from lib/oci/runner/* instead of re-defining:\n${violations.join('\n')}`
  );
});

// ---------------------------------------------------------------------------
// 3) google-ads-export submodules exist and export the right symbols
// ---------------------------------------------------------------------------

const EXPORT_SUBMODULES: Array<{ path: string; exports: string[] }> = [
  {
    path: 'lib/oci/google-ads-export/types.ts',
    exports: [
      'GoogleAdsConversionItem',
      'GoogleAdsAdjustmentItem',
      'ExportCursorMark',
      'ExportCursorState',
      'QueueRow',
      'ExportSiteRow',
      'RankedExportCandidate',
    ],
  },
  {
    path: 'lib/oci/google-ads-export/signal-normalizers.ts',
    exports: ['resolveSignalStage', 'normalizeSignalChannel'],
  },
  {
    path: 'lib/oci/google-ads-export/sanitize.ts',
    exports: ['ensureNumericValue', 'ensureCurrencyCode', 'readExportCursorMark'],
  },
];

for (const { path, exports } of EXPORT_SUBMODULES) {
  test(`google-ads-export submodule exists and exports expected symbols: ${path}`, () => {
    const full = join(ROOT, path);
    assert.ok(existsSync(full), `missing submodule: ${path}`);
    const src = readFileSync(full, 'utf8');
    for (const sym of exports) {
      const pattern = new RegExp(`export (interface|type|(async )?function|const) ${sym}\\b`);
      assert.ok(pattern.test(src), `${path} missing export ${sym}`);
    }
  });
}

// ---------------------------------------------------------------------------
// 4) google-ads-export route does not redefine extracted helpers locally
// ---------------------------------------------------------------------------

test('google-ads-export route does not redefine extracted helpers locally', () => {
  const src = readFileSync(
    join(ROOT, 'app/api/oci/google-ads-export/route.ts'),
    'utf8'
  );
  const bannedLocalDefs = [
    /^function resolveSignalStage\b/m,
    /^function normalizeSignalChannel\b/m,
    /^function ensureNumericValue\b/m,
    /^function ensureCurrencyCode\b/m,
    /^function readExportCursorMark\b/m,
    /^interface GoogleAdsConversionItem\b/m,
    /^interface GoogleAdsAdjustmentItem\b/m,
  ];
  const violations: string[] = [];
  for (const re of bannedLocalDefs) {
    if (re.test(src)) violations.push(re.toString());
  }
  assert.equal(
    violations.length,
    0,
    `google-ads-export route should import from lib/oci/google-ads-export/* instead of redefining:\n${violations.join(
      '\n'
    )}`
  );
});

// ---------------------------------------------------------------------------
// 5) Line budgets — catch future god-object regressions early
// ---------------------------------------------------------------------------

/**
 * Budgets are deliberately close to the post-split sizes. If the parent files
 * grow past these numbers, the right move is extraction — not bumping the
 * number. Bumping should be a conscious, reviewed act.
 */
const LINE_BUDGETS: Array<{ path: string; maxLines: number }> = [
  { path: 'lib/oci/runner.ts', maxLines: 1100 },
  { path: 'app/api/oci/google-ads-export/route.ts', maxLines: 1200 },
];

for (const { path, maxLines } of LINE_BUDGETS) {
  test(`parent file stays under its line budget: ${path}`, () => {
    const src = readFileSync(join(ROOT, path), 'utf8');
    const lines = src.split(/\r?\n/).length;
    assert.ok(
      lines <= maxLines,
      `${path} has grown to ${lines} lines (budget: ${maxLines}). Extract helpers instead of inflating the parent.`
    );
  });
}
