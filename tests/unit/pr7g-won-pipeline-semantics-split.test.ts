import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('PR-7G won pipeline health counts failed terminal as represented', () => {
  const sql = readFileSync(join(ROOT, 'scripts', 'sql', 'won_pipeline_health.sql'), 'utf8');
  assert.ok(sql.includes("q.action = 'OpsMantik_Won'"));
  assert.ok(sql.includes("q.status IN ('FAILED', 'DEAD_LETTER_QUARANTINE', 'VOIDED_BY_REVERSAL')"));
  assert.ok(sql.includes('won_represented_failed_terminal_count'));
  assert.ok(sql.includes('won_pipeline_represented_total'));
});

test('PR-7G won missing metric means unrepresented only', () => {
  const sql = readFileSync(join(ROOT, 'scripts', 'sql', 'won_pipeline_health.sql'), 'utf8');
  assert.ok(sql.includes('missing_unrepresented'));
  assert.ok(sql.includes('won_missing_unrepresented_count'));
  assert.ok(sql.includes('won_missing_pipeline_count'));
  assert.ok(sql.includes('won_missing_pipeline'));
  assert.ok(sql.includes('LEFT JOIN represented_any'));
});

test('PR-7G rollout readiness surfaces terminal failed represented rows separately', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'oci-rollout-readiness.ts'), 'utf8');
  assert.ok(src.includes('wonRepresentedFailedTerminal'));
  assert.ok(src.includes('wonRepresentedFailedTerminalCount'));
  assert.ok(src.includes('wonPipelineRepresentedTotalCount'));
  assert.ok(src.includes('wonMissingPipelineCount: wonPipeline.wonMissingPipeline'));
});

test('PR-7G site stats use OpsMantik_Won action for representation', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'won-missing-pipeline-site.ts'), 'utf8');
  assert.ok(src.includes("const WON_ACTION = 'OpsMantik_Won'"));
  assert.ok(src.includes('if (action !== WON_ACTION) continue;'));
  assert.ok(src.includes('wonRepresentedFailedTerminal'));
  assert.ok(src.includes('wonPipelineRepresentedTotal'));
});
