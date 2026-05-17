import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const shimPath = join(process.cwd(), 'public/ux-core.js');

describe('public/ux-core.js back-compat shim', () => {
  it('loads canonical /assets/core.js only (no embedded tracker)', () => {
    const shim = readFileSync(shimPath, 'utf-8');
    expect(shim).toContain("/assets/core.js");
    expect(shim).not.toMatch(/\/api\/call-event(?!\/v2)/);
    expect(shim).not.toContain('opsmantik_outbox');
    expect(shim.length).toBeLessThan(1024);
  });
});
