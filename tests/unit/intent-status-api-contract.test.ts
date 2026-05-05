import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  INTENT_STATUS_ROUTE_EXECUTABLE,
  INTENT_STATUS_ROUTE_RECOGNIZED,
  INTENT_STATUS_ROUTE_UNSUPPORTED,
  INTENT_STATUS_ROUTE_UNSUPPORTED_REASON,
  classifyIntentStatusRoute,
  normalizeIntentRouteStatus,
} from '@/lib/api/intent-status-route-contract';

const ROUTE_TS = join(
  process.cwd(),
  'app',
  'api',
  'intents',
  '[id]',
  'status',
  'route.ts'
);

test('classifyIntentStatusRoute: every executable status resolves to executable verdict', () => {
  const expectedStages: Record<(typeof INTENT_STATUS_ROUTE_EXECUTABLE)[number], 'junk' | 'contacted'> =
    {
      junk: 'junk',
      cancelled: 'junk',
      intent: 'contacted',
    };
  for (const s of INTENT_STATUS_ROUTE_EXECUTABLE) {
    const v = classifyIntentStatusRoute(s);
    assert.equal(v.kind, 'executable');
    if (v.kind !== 'executable') continue;
    assert.equal(v.rpcStage, expectedStages[v.normalized]);
    assert.equal(
      v.reviewed,
      v.normalized !== 'intent',
      'restore (intent body) clears reviewed markers'
    );
  }
});

test('classifyIntentStatusRoute: unsupported family returns UNSUPPORTED_STATUS reason verbatim', () => {
  for (const s of INTENT_STATUS_ROUTE_UNSUPPORTED) {
    const v = classifyIntentStatusRoute(s);
    assert.equal(v.kind, 'unsupported');
    if (v.kind !== 'unsupported') continue;
    assert.equal(v.code, 'UNSUPPORTED_STATUS');
    assert.equal(v.normalized, s);
    assert.equal(v.reason, INTENT_STATUS_ROUTE_UNSUPPORTED_REASON);
  }
});

test('classifyIntentStatusRoute: unknown and terminal-ish labels → INVALID_STATUS (never executable)', () => {
  for (const raw of ['won', 'offered', 'contacted', 'foo', '__']) {
    const normalized = normalizeIntentRouteStatus(raw);
    const v = classifyIntentStatusRoute(normalized);
    assert.equal(v.kind, 'invalid');
    if (v.kind !== 'invalid') continue;
    assert.equal(v.code, 'INVALID_STATUS');
    assert.ok(v.reason.includes('Unknown') || normalized === null,
      `${raw} rejected as INVALID_STATUS`
    );
  }
});

test('classifyIntentStatusRoute: missing → INVALID_STATUS', () => {
  const v = classifyIntentStatusRoute(normalizeIntentRouteStatus(undefined));
  assert.equal(v.kind, 'invalid');
  if (v.kind === 'invalid') assert.match(v.reason, /Missing|empty/i);
});

test('normalizeIntentRouteStatus: folds case safely for executable statuses', () => {
  assert.equal(normalizeIntentRouteStatus(' InTeNt '), 'intent');
  assert.equal(normalizeIntentRouteStatus('JUNK'), 'junk');
});

test('status route binds contract and returns structured unsupported errors', () => {
  const src = readFileSync(ROUTE_TS, 'utf8');
  assert.ok(
    src.includes("from '@/lib/api/intent-status-route-contract'"),
    'route imports shared contract module'
  );
  assert.ok(
    src.includes("kind === 'unsupported'") &&
      src.includes('ok: false') &&
      src.includes('code: statusVerdict.code'),
    'route returns ok/code/status/reason for unsupported inputs'
  );
  assert.ok(
    src.includes('p_reviewed: statusVerdict.reviewed'),
    'restore path must derive reviewed RPC flag from contract verdict'
  );
});

test('recognized status inventory matches contract exports', () => {
  const fromExecutable = [...INTENT_STATUS_ROUTE_EXECUTABLE];
  const fromUnsupported = [...INTENT_STATUS_ROUTE_UNSUPPORTED];
  const merged = [...fromExecutable, ...fromUnsupported].sort();
  const recognized = [...INTENT_STATUS_ROUTE_RECOGNIZED].sort();
  assert.deepEqual([...merged].sort(), recognized);
});
