#!/usr/bin/env node
/**
 * Cross-platform: sets TARGET_DB_EVIDENCE_STRICT=1 then runs production evidence
 * (bash `VAR=1 cmd` does not work in PowerShell).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = { ...process.env, TARGET_DB_EVIDENCE_STRICT: '1' };

const r = spawnSync(
  process.execPath,
  ['scripts/release/collect-gate-evidence.mjs', '--mode=production', '--output', 'tmp/release-gates-production.md'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
    shell: false,
  }
);

process.exit(r.status ?? 1);
