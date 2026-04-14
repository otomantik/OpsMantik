/**
 * PR4-D: authoritative paid/organic — truth table vs legacy ternary (no behavior change).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveCallEventAuthoritativePaidOrganic } from '@/lib/domain/deterministic-engine/call-event-authoritative-source';

function legacyTernary(
  sanitizedGclid: string | null,
  sanitizedWbraid: string | null,
  sanitizedGbraid: string | null,
  sanitizedClickId: string | null
): 'paid' | 'organic' {
  return sanitizedGclid || sanitizedWbraid || sanitizedGbraid || sanitizedClickId ? 'paid' : 'organic';
}

test('deriveCallEventAuthoritativePaidOrganic: full truth table matches legacy ternary', () => {
  const present = 'x';
  for (let mask = 0; mask < 16; mask += 1) {
    const g = mask & 1 ? present : null;
    const w = mask & 2 ? present : null;
    const b = mask & 4 ? present : null;
    const c = mask & 8 ? present : null;
    const expected = legacyTernary(g, w, b, c);
    const actual = deriveCallEventAuthoritativePaidOrganic({
      sanitizedGclid: g,
      sanitizedWbraid: w,
      sanitizedGbraid: b,
      sanitizedClickId: c,
    });
    assert.equal(actual, expected, `mask=${mask}`);
  }
});
