#!/usr/bin/env node
/**
 * PR-9I — Universal script drain audit (wrapper).
 * Delegates to `pr9i-universal-script-drain-audit-cli.ts` via `tsx` (read-only; no DB mutations).
 *
 * Usage:
 *   node scripts/db/pr9i-universal-script-drain-audit.mjs
 *   PR9I_SITE_ID=<uuid|public_id> LIMIT=5000 node scripts/db/pr9i-universal-script-drain-audit.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cli = join(__dirname, 'pr9i-universal-script-drain-audit-cli.ts');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const r = spawnSync(npx, ['tsx', cli, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
process.exit(r.status === null ? 1 : r.status);
