/**
 * OCI Truth — i18n keys for queue status tooltips must exist and avoid absolute “Google proved import” claims.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEYS = [
  'ociControl.statusTruth.UPLOADED',
  'ociControl.statusTruth.COMPLETED',
  'ociControl.statusTruth.COMPLETED_UNVERIFIED',
  'ociControl.statusTruthHintLabel',
] as const;

const DENY_EN = /\b(definitely|guaranteed|certainly accepted)\b/i;

function extractEnSingleQuoted(src: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`'${esc}'\\s*:\\s*\\n\\s*'((?:\\\\.|[^'\\\\])*)'`, 'm');
  const m = src.match(re);
  return m ? m[1].replace(/\\'/g, "'") : null;
}

function extractTrStatusTruthBlock(src: string, key: string): string {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"${esc}"\\s*:\\s*\\n\\s*"([^"]+)"`, 'm');
  const m = src.match(re);
  return m ? m[1] : '';
}

test('ociControl.statusTruth keys exist in en and tr', () => {
  const en = readFileSync(join(process.cwd(), 'lib', 'i18n', 'messages', 'en.ts'), 'utf8');
  const tr = readFileSync(join(process.cwd(), 'lib', 'i18n', 'messages', 'tr.ts'), 'utf8');
  for (const k of KEYS) {
    assert.ok(en.includes(`'${k}':`) || en.includes(`"${k}":`), `en missing ${k}`);
    assert.ok(tr.includes(`"${k}":`), `tr missing ${k}`);
  }
});

test('ociControl.statusTruth keys exist in it', () => {
  const it = readFileSync(join(process.cwd(), 'lib', 'i18n', 'messages', 'it.ts'), 'utf8');
  for (const k of KEYS) {
    assert.ok(it.includes(`"${k}":`), `it missing ${k}`);
  }
});

test('ociControl.statusTruth IT copy length and no absolute hype markers', () => {
  const it = readFileSync(join(process.cwd(), 'lib', 'i18n', 'messages', 'it.ts'), 'utf8');
  const denyIt = /\b(definitivamente|garantito|certamente accettat[oa])\b/i;
  for (const k of KEYS) {
    if (k === 'ociControl.statusTruthHintLabel') continue;
    const tv = extractTrStatusTruthBlock(it, k);
    assert.ok(tv.length > 20, `it value for ${k}`);
    assert.ok(!denyIt.test(tv), `it ${k} must not use forbidden hype: ${tv}`);
  }
});

test('ociControl.statusTruth copy avoids absolute provider-import hype (en)', () => {
  const en = readFileSync(join(process.cwd(), 'lib', 'i18n', 'messages', 'en.ts'), 'utf8');
  for (const k of KEYS) {
    if (k === 'ociControl.statusTruthHintLabel') continue;
    const ev = extractEnSingleQuoted(en, k);
    assert.ok(ev && ev.length > 20, `en value for ${k}`);
    assert.ok(!DENY_EN.test(ev), `en ${k} must not use forbidden hype: ${ev}`);
  }
});

test('ociControl.statusTruth TR strings negate absolute import claims where applicable', () => {
  const tr = readFileSync(join(process.cwd(), 'lib', 'i18n', 'messages', 'tr.ts'), 'utf8');
  for (const k of KEYS) {
    if (k === 'ociControl.statusTruthHintLabel') continue;
    const tv = extractTrStatusTruthBlock(tr, k);
    assert.ok(tv.length > 20, `tr value for ${k}`);
    if (k === 'ociControl.statusTruth.UPLOADED' || k === 'ociControl.statusTruth.COMPLETED') {
      assert.ok(
        /anlamına\s+gelmez|gelmez/i.test(tv),
        `tr ${k} should include explicit negation of over-claim (e.g. …gelmez)`
      );
    }
  }
});
