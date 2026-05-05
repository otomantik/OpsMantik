import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';

/**
 * Secret heuristics for Google Ads scripts:
 * - explicit oci_ token
 * - long hex blobs (>= 40 chars)
 * - base64url-like tokens (>= 48 chars)
 */
const OCI_KEY_LIKE = /\boci_[A-Za-z0-9_-]{24,}\b/g;
const LONG_HEX_LIKE = /\b[a-fA-F0-9]{40,}\b/g;
const BASE64URL_LIKE = /\b[A-Za-z0-9_-]{48,}\b/g;

const ALLOWLIST_SUBSTRINGS = [
  'mock',
  'placeholder',
  'changeme',
  'example',
  'your-secret-key-here',
];

function isAllowedToken(token: string): boolean {
  const t = token.toLowerCase();
  return ALLOWLIST_SUBSTRINGS.some((x) => t.includes(x));
}

test('scripts/google-ads-oci: no inline OCI API key literals', () => {
  const root = join(process.cwd(), 'scripts', 'google-ads-oci');
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(p));
      else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p);
    }
    return out;
  };
  for (const file of walk(root)) {
    const body = readFileSync(file, 'utf8');
    const hits = [
      ...(body.match(OCI_KEY_LIKE) ?? []),
      ...(body.match(LONG_HEX_LIKE) ?? []),
      ...(body.match(BASE64URL_LIKE) ?? []),
    ];
    // Deduplicate and skip obvious constant-like names that are not secrets.
    const uniq = Array.from(new Set(hits)).filter((h) => !/^[A-Z0-9_]+$/.test(h));
    const bad = uniq.filter((h) => !isAllowedToken(h));
    assert.equal(
      bad.length,
      0,
      `${basename(file)}: suspicious secret-like literals: ${bad.join(', ')}`
    );
  }
});
