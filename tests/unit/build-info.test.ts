/**
 * Unit tests for getBuildInfoHeaders (pure helper; no route imports).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBuildInfoHeaders,
  HEADER_COMMIT,
  HEADER_BRANCH,
} from '@/lib/build-info';

function stashEnv(keys: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) {
    out[k] = process.env[k];
  }
  return out;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const k of Object.keys(snapshot)) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

test('getBuildInfoHeaders: returns x-opsmantik-commit and x-opsmantik-branch', () => {
  const headers = getBuildInfoHeaders();
  assert.ok(HEADER_COMMIT in headers);
  assert.ok(HEADER_BRANCH in headers);
  assert.equal(typeof headers[HEADER_COMMIT], 'string');
  assert.equal(typeof headers[HEADER_BRANCH], 'string');
});

test('getBuildInfoHeaders: when VERCEL_GIT_COMMIT_SHA set, commit is that value', () => {
  const envKeys = ['VERCEL_GIT_COMMIT_SHA', 'VERCEL_GIT_COMMIT_REF'];
  const saved = stashEnv(envKeys);
  try {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123def';
    process.env.VERCEL_GIT_COMMIT_REF = 'main';
    const headers = getBuildInfoHeaders();
    assert.equal(headers[HEADER_COMMIT], 'abc123def');
    assert.equal(headers[HEADER_BRANCH], 'main');
  } finally {
    restoreEnv(saved);
  }
});

test('getBuildInfoHeaders: when env missing, returns "unknown"', () => {
  const envKeys = ['VERCEL_GIT_COMMIT_SHA', 'VERCEL_GIT_COMMIT_REF'];
  const saved = stashEnv(envKeys);
  try {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_REF;
    const headers = getBuildInfoHeaders();
    assert.equal(headers[HEADER_COMMIT], 'unknown');
    assert.equal(headers[HEADER_BRANCH], 'unknown');
  } finally {
    restoreEnv(saved);
  }
});

test('getBuildInfoHeaders: empty string env becomes "unknown"', () => {
  const envKeys = ['VERCEL_GIT_COMMIT_SHA', 'VERCEL_GIT_COMMIT_REF'];
  const saved = stashEnv(envKeys);
  try {
    process.env.VERCEL_GIT_COMMIT_SHA = '';
    process.env.VERCEL_GIT_COMMIT_REF = '  ';
    const headers = getBuildInfoHeaders();
    assert.equal(headers[HEADER_COMMIT], 'unknown');
    assert.equal(headers[HEADER_BRANCH], 'unknown');
  } finally {
    restoreEnv(saved);
  }
});
